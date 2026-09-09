import type { ControlMasterHandler, ControlMasterOptions, ControlMasterInject } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AskPassHandler } from '../ask-pass/index.js';

import { SpawnSSHTimeoutGuard, SpawnSSHTarget, TeardownGuard } from '../spawn-ssh/index.js';
import { ControlMasterSocket } from './control-master.socket.js';
import { ControlMasterReady } from './control-master.ready.js';
import { SSHEnvironment } from '../ssh-environment/index.js';
import { LastResort } from '../last-resort/index.js';
import { SSHConfig } from '../ssh-config/index.js';
import { AskPass } from '../ask-pass/index.js';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

/**
 * One authenticated connection, opened once and lent to any number of
 * commands.
 *
 * Without it every command is a connection of its own: a handshake, an
 * authentication, and — with a password — a helper, a socket and a secret on
 * the heap, once per command. Ten commands are ten authentications, which is
 * slow against any host and, against one that counts failed and repeated
 * logins, a way to get the account locked out.
 *
 * What holds it open is a real process: `ssh -N`, which runs no remote command
 * and exists only to own the socket. That is deliberate. The alternative —
 * letting the first command promote itself with `ControlPersist` — leaves an
 * authenticated connection alive in the background with nobody owning it, and
 * outliving the process that opened it. Here the connection has an owner, and
 * `close` is what ends it.
 */
export class ControlMaster implements ControlMasterHandler {
    /**
     * A master that never finishes authenticating never says so — it just
     * sits there — so unlike the timeout of a command this one cannot be
     * left out. It only has to be generous enough for a handshake and a
     * password over a slow link.
     */
    static #TIMEOUT = 20_000;

    /**
     * A master says nothing while it works, but it lives for as long as the
     * session does, and whatever it *might* say over hours of that is not
     * worth an array that only ever grows. What explains a failure is the
     * beginning of it anyway.
     */
    static #STDERR = 8192;

    #injected: Required<ControlMasterInject>;
    #child: ChildProcessWithoutNullStreams | null;
    #opening: Promise<void> | null;
    #options: ControlMasterOptions;
    #dead: Error | null;
    #path: string | null;

    constructor(options: ControlMasterOptions, inject?: ControlMasterInject) {
        this.#options = options;
        this.#opening = null;
        this.#child   = null;
        this.#dead    = null;
        this.#path    = null;
        this.#injected = {
            timeoutGuard: inject?.timeoutGuard?.bind(inject) ?? (t => new SpawnSSHTimeoutGuard(t)),
            lastResort:   inject?.lastResort                 ?? LastResort.shared,
            askPass:      inject?.askPass?.bind(inject)      ?? (() => new AskPass()),
            socket:       inject?.socket                     ?? new ControlMasterSocket(),
            ready:        inject?.ready?.bind(inject)        ?? ((a, e) => new ControlMasterReady(a, e)),
            rmSync:       inject?.rmSync?.bind(inject)       ?? rmSync,
            spawn:        inject?.spawn?.bind(inject)        ?? spawn
        };
    }

    /**
     * Why the connection is not there any more, in the words of `ssh` itself.
     *
     * A master says nothing at all while it works, so whatever reached its
     * stderr is the whole explanation there is going to be — a refused
     * password, a host key that changed, a name that does not resolve.
     */
    #reasonOf(stderr: Buffer[], code: number | null, signal: NodeJS.Signals | null): Error {
        const said = Buffer.concat(stderr).toString('utf-8').trim();
        const how = signal
            ? `was killed with ${signal}`
            : `exited with code ${code}`;

        const error = new Error(
            `The ssh connection is not available: the master ${how}.`
            + (said ? ` It said: ${said}` : '')
        );

        error.name = 'ConnectionError';
        return error;
    }

    /**
     * The deadline is shared with the one a command runs under, and so is its
     * wording. What ran out here is the time to *open* the connection, before
     * there was any command to blame for it, and the caller of `open` deserves
     * to be told that instead.
     */
    #deadlineOf(error: unknown, deadline: number): unknown {
        if (!(error instanceof Error) || error.name !== 'TimeoutError') {
            return error;
        }

        const replacement = new Error(
            `The ssh connection could not be opened within ${deadline} ms.`,
            { cause: error }
        );

        replacement.name = 'TimeoutError';
        return replacement;
    }

    /**
     * `-O check` asks the socket rather than the network: it neither connects
     * nor authenticates, so the host key policy, the credential and the
     * algorithms are the business of the master alone and none of them belong
     * here.
     */
    #probeOf(path: string, target: string): string[] {
        return [
            '-o', `ControlPath=${path}`,
            '-O', 'check',
            '--',
            target
        ];
    }

    /**
     * `-N` is what makes this a connection and not a command: no remote
     * program is run, and the process exists only to hold the socket open.
     *
     * The options are closed with `--` for the same reason every other argv in
     * this library is — a destination that begins with a `-` must be a bad
     * destination and never an option.
     */
    #argvOf(path: string, target: string): string[] {
        const config = new SSHConfig({
            hostKeyChecking:  this.#options.hostKeyChecking,
            legacyAlgorithms: this.#options.legacyAlgorithms,
            password:         this.#options.password,
            controlMaster:    true,
            controlPath:      path
        }).value();

        return [
            ...config,
            '-N',
            '--',
            target
        ];
    }

    async #open(): Promise<void> {
        const { password, cwd } = this.#options;

        // Both before anything exists on disk: a destination `ssh` would read
        // as an option and a deadline that makes no sense are refused while
        // there is still nothing to clean up after.
        const target = new SpawnSSHTarget(this.#options.username, this.#options.hostname).value();
        const deadline = this.#options.connectTimeout ?? ControlMaster.#TIMEOUT;
        const timeout = this.#injected.timeoutGuard(deadline);

        this.#dead = null;
        const environment = new SSHEnvironment(this.#options.env);
        const { directory, path } = await this.#injected.socket.create();
        const askPass = password ? this.#injected.askPass() : null;

        let child: ChildProcessWithoutNullStreams;
        try {
            // Kept inside the `try`: a helper that fails to open still has a
            // teardown owed to it, and so does the directory.
            const askPassEnv = password && askPass
                ? await askPass.open(password)
                : undefined;

            child = this.#injected.spawn('ssh', this.#argvOf(path, target), {
                stdio: 'pipe',
                cwd,
                env: environment.value(askPassEnv)
            });
        } catch (error) {
            await askPass?.close().catch(() => {});
            await this.#injected.socket.remove().catch(() => {});
            throw error;
        }

        this.#child = child;

        // Nothing kills a child just because its parent died, and an orphaned
        // master is worse than an orphaned directory: it is an authenticated
        // session nobody owns any more.
        this.#injected.lastResort.protect(directory, () => {
            try { child.kill('SIGTERM'); } catch { /* already gone */ }
            this.#injected.rmSync(directory, { recursive: true, force: true });
        });

        // The only thing a master ever says, and only when it fails.
        const stderr: Buffer[] = [];
        let said = 0;
        child.stderr.on('data', (chunk: Buffer) => {
            if (said >= ControlMaster.#STDERR) { return; }

            said += chunk.length;
            stderr.push(chunk);
        });

        // First cause wins: the deadline kills the process and *then* raises
        // its error, and the ordinary exit that follows must not overwrite
        // the reason the caller is actually waiting to hear.
        child.once('error', error => { this.#dead ??= error; });
        child.once('exit', (code, signal) => {
            this.#dead ??= this.#reasonOf(stderr, code, signal);
        });

        // Hooked where the consumer cannot detach it. A connection that dies
        // takes its socket, its helper and its `path` with it: from then on
        // there is nothing to ride on, and saying so is what keeps a command
        // from quietly authenticating all over again.
        new TeardownGuard(child, async () => {
            timeout.disarm();
            this.#child = null;
            this.#path  = null;
            this.#injected.lastResort.release(directory);
            await askPass?.close();
            await this.#injected.socket.remove();
        }).attach();

        timeout.attach(child);
        try {
            await this.#injected.ready(this.#probeOf(path, target), environment.value())
                .wait(() => this.#dead);
        } catch (error) {
            // Whatever ended the wait, the master must not outlive it. It is
            // usually already gone — that is what ended the wait — and killing
            // one that is is a no-op; what this covers is the wait ending any
            // other way, which would otherwise leave an authenticated
            // connection behind with nobody left to close it.
            child.kill('SIGTERM');
            throw this.#deadlineOf(error, deadline);
        }

        timeout.disarm();
        this.#path = path;

        // The password bought the connection, and the socket stands for it
        // from here on. Every command after this one runs with no credential
        // in play at all, so there is no reason to keep the secret on the
        // heap — nor the helper reachable — for the rest of the session.
        await askPass?.close();
    }

    get path(): string | null {
        return this.#path;
    }

    /**
     * Kills the master and waits for it to actually be gone.
     *
     * `SIGTERM` and not `SIGKILL`: `ssh` handles it, and on its way out it
     * tears the connection down instead of leaving the remote end to notice
     * on its own. Everything else — the helper, the private directory, the
     * emergency cleanup — is released by the teardown the child already owes,
     * whichever way it ends up dying.
     */
    async close(): Promise<void> {
        const child = this.#child;
        this.#path = null;

        if (!child) {
            // Never opened, already dead, or an opening that failed halfway:
            // the directory may still be owed either way.
            await this.#injected.socket.remove();
            return;
        }

        const ended = new Promise<void>(resolve => {
            child.once('close', () => resolve());
            child.once('error', () => resolve());
            child.once('exit',  () => resolve());
        });

        child.kill('SIGTERM');
        await ended;
    }

    /**
     * Opening twice is not an error, and two callers opening at once get the
     * same connection rather than one each: a second master would authenticate
     * again for nothing and leave a socket nobody remembers to close.
     */
    async open(): Promise<void> {
        if (this.#path) { return; }

        this.#opening ??= this.#open();
        try {
            await this.#opening;
        } finally {
            this.#opening = null;
        }
    }
}

import type { SpawnSSHTimeoutGuardHandler, SpawnSSHInject, SpawnSSHOptions } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AskPassHandler } from '../ask-pass/index.js';

import { SpawnSSHTimeoutGuard } from './spawn-ssh.timeout-guard.js';
import { SpawnSSHRemoteCommand } from './spawn-ssh.remote-command.js';
import { TeardownGuard } from './spawn-ssh.teardown-guard.js';
import { SSHEnvironment } from '../ssh-environment/index.js';
import { SpawnSSHTarget } from './spawn-ssh.target.js';
import { SSHConfig } from '../ssh-config/index.js';
import { AskPass } from '../ask-pass/index.js';
import { spawn } from 'node:child_process';

export class SpawnSSH {
    #injected: Required<SpawnSSHInject>;
    #options: SpawnSSHOptions;

    constructor(
        options: SpawnSSHOptions,
        inject?: SpawnSSHInject
    ) {
        this.#options = options;
        this.#injected = {
            timeoutGuard: inject?.timeoutGuard?.bind(inject) ?? (t => new SpawnSSHTimeoutGuard(t)),
            askPass:      inject?.askPass?.bind(inject)      ?? (() => new AskPass()),
            spawn:        inject?.spawn?.bind(inject)        ?? spawn
        };
    }

    /**
     * The secret this invocation has to prove itself with, if it is the one
     * that has to prove anything at all.
     *
     * A `controlPath` says the master already did, and the socket is the
     * credential from here on: no helper is set up, no secret is put on the
     * heap, and nothing is left to tear down. That is what makes a reused
     * connection cost the password once instead of once per command.
     */
    #credential(): string | null {
        const { password, controlPath } = this.#options;
        if (!password || controlPath) { return null; }

        return password;
    }

    /**
     * Neither branch passes `-n`. It would point the stdin of `ssh` at
     * `/dev/null`, and there is nothing left for it to protect: the child is
     * spawned with `stdio: 'pipe'`, so what it reads is a pipe of its own and
     * never the stdin of this process, and `SSH_ASKPASS_REQUIRE=force` is what
     * keeps the password off the terminal. All it did was make the writable
     * `stdin` of the returned child a lie — a pipe with nobody at the other
     * end, which swallows the first writes and then blocks forever. Without
     * it, feeding a remote command through its stdin works.
     *
     * The options are closed with `--`. Without it a `username` of
     * `-oProxyCommand=...` becomes the argv element `-oProxyCommand=...@host`,
     * which `ssh` reads as an option and obeys — running a command *locally*,
     * before it ever authenticates. The separator turns that back into what it
     * always was: a destination, and a bad one.
     */
    #argvOf(program: string, args?: string[]): string[] {
        const { username, hostname, password, shell, controlPath } = this.#options;
        const target = new SpawnSSHTarget(username, hostname).value();
        const remote = new SpawnSSHRemoteCommand(
            program,
            args ?? [],
            shell ?? false
        ).value();

        const config = new SSHConfig({
            hostKeyChecking:  this.#options.hostKeyChecking,
            legacyAlgorithms: this.#options.legacyAlgorithms,
            password,
            controlPath
        }).value();

        return [
            ...config,
            '--',           // no option may follow
            target,
            remote
        ];
    }

    /**
     * Everything the child owes back when it dies, hooked where the consumer
     * cannot detach it: a pending timer, and a socket still holding a
     * credential. `TeardownGuard` stays out of the listener registry precisely
     * so that a `removeAllListeners()` — the kind of thing anyone writes to
     * clean up after themselves — does not take the cleanup with it.
     */
    #watch(
        child: ChildProcessWithoutNullStreams,
        timeout: SpawnSSHTimeoutGuardHandler,
        askPass: AskPassHandler | null
    ): void {
        timeout.attach(child);
        new TeardownGuard(child, async () => {
            timeout.disarm();
            await askPass?.close();
        }).attach();
    }

    async spawn(program: string, args?: string[]): Promise<ChildProcessWithoutNullStreams> {
        const environment = new SSHEnvironment(this.#options.env);
        const argv = this.#argvOf(program, args);

        // Built first, and on purpose: this is what refuses a timeout that
        // makes no sense, and it has to do it while there is still nothing
        // running to clean up after.
        const timeout = this.#injected.timeoutGuard(this.#options.timeout);

        const password = this.#credential();
        if (password === null) {
            const child = this.#injected.spawn('ssh', argv, {
                stdio: 'pipe',
                cwd: this.#options.cwd,
                env: environment.value()
            });

            this.#watch(child, timeout, null);
            return child;
        }

        const askPass = this.#injected.askPass();

        let child: ChildProcessWithoutNullStreams;
        try {
            // Kept inside the `try`: a helper that fails to open still has a
            // teardown owed to it.
            const askPassEnv = await askPass.open(password);

            child = this.#injected.spawn('ssh', argv, {
                stdio: 'pipe',
                cwd: this.#options.cwd,
                env: environment.value(askPassEnv)
            });
        } catch (error) {
            // Whatever the helper got to set up before things went wrong — a
            // listening socket, a script on disk, the secret still on the heap
            // — no child process is coming to trigger its teardown. Closing it
            // must not hide why the launch failed, though.
            await askPass.close().catch(() => {});
            throw error;
        }

        this.#watch(child, timeout, askPass);
        return child;
    }
}
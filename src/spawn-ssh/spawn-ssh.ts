import type { SpawnSSHTimeoutGuardHandler, SpawnSSHInject, SpawnSSHOptions } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AskPassHandler } from '../ask-pass/index.js';

import { SpawnSSHTimeoutGuard } from './spawn-ssh.timeout-guard.js';
import { SpawnSSHRemoteCommand } from './spawn-ssh.remote-command.js';
import { TeardownGuard } from './spawn-ssh.teardown-guard.js';
import { SpawnSSHTarget } from './spawn-ssh.target.js';
import { AskPass } from '../ask-pass/index.js';
import { spawn } from 'node:child_process';

export class SpawnSSH {
    static #POLICIES: readonly string[] = [ 'accept-new', 'yes', 'no' ];

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
     * The union type is the contract, but a JavaScript consumer has no types:
     * an unknown value would reach `ssh` as an unknown config value, and how
     * `ssh` treats the host key from there is not something to leave to a
     * typo.
     */
    #hostKeyChecking(): 'accept-new' | 'yes' | 'no' {
        const policy = this.#options.hostKeyChecking ?? 'accept-new';
        if (!SpawnSSH.#POLICIES.includes(policy)) {
            throw new Error(
                `Unknown hostKeyChecking ${JSON.stringify(policy)}, expected one of: `
                + SpawnSSH.#POLICIES.join(', ') + '.'
            );
        }

        return policy;
    }

    /**
     * The askpass variables win over the inherited ones — that is the whole
     * point of them — except `DISPLAY`.
     *
     * `DISPLAY` is only a safety net for OpenSSH < 8.4, which consults the
     * helper solely when it believes it is in a graphical session. Any value
     * satisfies that belief, so a `DISPLAY` the caller already had does the job
     * just as well, and overwriting it would change what the child process sees
     * of the caller's own session for no gain.
     */
    #withAskPass(env: NodeJS.ProcessEnv, askPass: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
        const merged = { ...env, ...askPass };
        if (env.DISPLAY) {
            merged.DISPLAY = env.DISPLAY;
        }

        return merged;
    }

    /**
     * With a password, `BatchMode` must be turned off, because that is exactly
     * what forbids `ssh` from consulting the `SSH_ASKPASS` helper.
     *
     * Neither branch passes `-n`. It would point the stdin of `ssh` at
     * `/dev/null`, and there is nothing left for it to protect: the child is
     * spawned with `stdio: 'pipe'`, so what it reads is a pipe of its own and
     * never the stdin of this process, and `SSH_ASKPASS_REQUIRE=force` is what
     * keeps the password off the terminal. All it did was make the writable
     * `stdin` of the returned child a lie — a pipe with nobody at the other
     * end, which swallows the first writes and then blocks forever. Without
     * it, feeding a remote command through its stdin works.
     *
     * Every branch closes its options with `--`. Without it a `username` of
     * `-oProxyCommand=...` becomes the argv element `-oProxyCommand=...@host`,
     * which `ssh` reads as an option and obeys — running a command *locally*,
     * before it ever authenticates. The separator turns that back into what it
     * always was: a destination, and a bad one.
     */
    #argvOf(program: string, args?: string[]): string[] {
        const { username, hostname, password, shell } = this.#options;
        const target = new SpawnSSHTarget(username, hostname).value();
        const policy = this.#hostKeyChecking();
        const remote = new SpawnSSHRemoteCommand(
            program,
            args ?? [],
            shell ?? false
        ).value();

        if (!password) {
            return [
                '-o', 'BatchMode=yes',                    // never ask, just fail
                '-o', `StrictHostKeyChecking=${policy}`,
                '-o', 'ConnectTimeout=10',                // don't hang on a dead network
                '--',                                     // no option may follow
                target,
                remote
            ];
        }

        // `+ssh-rsa` only appends the algorithm to the end of the list: with a
        // modern server the very same thing as always gets negotiated, and with
        // an old one the alternative was not being able to connect at all. It
        // stays opt-in, so nothing is negotiated down behind the caller's back.
        const legacy = this.#options.legacyAlgorithms
            ? [
                '-o', 'HostKeyAlgorithms=+ssh-rsa',
                '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa'
            ]
            : [];

        return [
            '-o', 'BatchMode=no',                     // enable the askpass helper
            '-o', `StrictHostKeyChecking=${policy}`,
            '-o', 'ConnectTimeout=10',
            '-o', 'NumberOfPasswordPrompts=1',        // don't retry the same password
            '-o', 'PubkeyAuthentication=no',          // go straight to the password
            '-o', 'PreferredAuthentications=password,keyboard-interactive',
            ...legacy,
            '--',
            target,
            remote
        ];
    }

    /**
     * With no explicit `env` we must start from our own, or `ssh` ends up
     * without `HOME` (known_hosts) nor `PATH`.
     *
     * Whatever the source, any inherited `SSH_ASKPASS` is dropped: the helper
     * belongs to this class, so the caller's environment must never decide who
     * gets asked for a credential. The password path overwrites both variables
     * with its own helper anyway, and the passwordless one is left with no
     * helper at all instead of whatever the parent happened to export.
     */
    #envOf(): NodeJS.ProcessEnv {
        const env = { ...this.#options.env ?? process.env };

        delete env.SSH_ASKPASS_REQUIRE;
        delete env.SSH_ASKPASS;

        return env;
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
        const env = this.#envOf();
        const argv = this.#argvOf(program, args);

        // Built first, and on purpose: this is what refuses a timeout that
        // makes no sense, and it has to do it while there is still nothing
        // running to clean up after.
        const timeout = this.#injected.timeoutGuard(this.#options.timeout);

        const { password } = this.#options;
        if (!password) {
            const child = this.#injected.spawn('ssh', argv, {
                stdio: 'pipe',
                cwd: this.#options.cwd,
                env
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
                env: this.#withAskPass(env, askPassEnv)
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
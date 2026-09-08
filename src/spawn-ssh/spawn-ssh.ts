import type { SpawnSSHInject, SpawnSSHOptions } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

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
            askPass:    inject?.askPass?.bind(inject)   ?? (() => new AskPass()),
            spawn:      inject?.spawn?.bind(inject)     ?? spawn
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
     * With a password, `BatchMode` must be turned off, because that is exactly
     * what forbids `ssh` from consulting the `SSH_ASKPASS` helper.
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
                '-n',                                     // don't consume the parent's stdin
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
            '-n',
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

    async spawn(program: string, args?: string[]): Promise<ChildProcessWithoutNullStreams> {
        const env = this.#envOf();
        const argv = this.#argvOf(program, args);

        const { password } = this.#options;
        if (!password) {
            return this.#injected.spawn('ssh', argv, {
                stdio: 'pipe',
                cwd: this.#options.cwd,
                env
            });
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

        // The teardown is hooked in a way the consumer cannot detach, because
        // what is left behind is a live socket holding a credential.
        new TeardownGuard(child, () => askPass.close()).attach();
        return child;
    }
}
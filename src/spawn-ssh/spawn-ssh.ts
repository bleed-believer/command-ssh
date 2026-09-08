import type { SpawnSSHInject, SpawnSSHOptions } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { SpawnSSHRemoteCommand } from './spawn-ssh.remote-command.js';
import { TeardownGuard } from './spawn-ssh.teardown-guard.js';
import { SpawnSSHTarget } from './spawn-ssh.target.js';
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
            askPass:    inject?.askPass?.bind(inject)   ?? (() => new AskPass()),
            spawn:      inject?.spawn?.bind(inject)     ?? spawn
        };
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
        const remote = new SpawnSSHRemoteCommand(
            program,
            args ?? [],
            shell ?? false
        ).value();

        if (!password) {
            return [
                '-o', 'BatchMode=yes',                    // never ask, just fail
                '-o', 'StrictHostKeyChecking=accept-new', // don't hang on an unknown host
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
            '-o', 'StrictHostKeyChecking=accept-new',
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
            child = this.#injected.spawn('ssh', argv, {
                stdio: 'pipe',
                cwd: this.#options.cwd,
                env: {
                    ...env,
                    ...await askPass.open(password)
                }
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
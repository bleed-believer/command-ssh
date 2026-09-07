import type { SpawnSSHInject, SpawnSSHOptions } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

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
     */
    #argvOf(program: string, args?: string[]): string[] {
        const { username, hostname, password } = this.#options;
        const target = `${username}@${hostname}`;
        const remote = [ program, ...(args ?? []) ].join(' ');

        if (!password) {
            return [
                '-o', 'BatchMode=yes',                    // never ask, just fail
                '-o', 'StrictHostKeyChecking=accept-new', // don't hang on an unknown host
                '-o', 'ConnectTimeout=10',                // don't hang on a dead network
                '-n',                                     // don't consume the parent's stdin
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
            target,
            remote
        ];
    }

    async spawn(program: string, args?: string[]): Promise<ChildProcessWithoutNullStreams> {
        // With no explicit `env` we must start from our own, or `ssh` ends up
        // without `HOME` (known_hosts) nor `PATH`.
        const env = this.#options.env ?? process.env;
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
        const child = this.#injected.spawn('ssh', argv, {
            stdio: 'pipe',
            cwd: this.#options.cwd,
            env: {
                ...env,
                ...await askPass.open(password)
            }
        });

        child.once('close', async () => {
            child.removeAllListeners();
            await askPass.close();
        });

        return child;
    }
}
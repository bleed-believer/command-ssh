import type { SpawnSSHTimeoutGuardHandler, SpawnSSHInject } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AskPassHandler } from '../ask-pass/index.js';

import { SpawnSSHTimeoutGuard } from './spawn-ssh.timeout-guard.js';
import { EventEmitter } from 'node:events';

/**
 * Shape of the double of the child process: only the surface `SpawnSSH` and
 * its consumers actually touch, so no real process nor socket is involved.
 */
type FakeChild = EventEmitter<{
    'error': [ error: Error ];
    'close': [ code: number | null ];
    'exit':  [ code: number | null, signal: NodeJS.Signals | null ];
}> & {
    stdin:  EventEmitter<{ data: [ chunk: Buffer ] }>;
    stdout: EventEmitter<{ data: [ chunk: Buffer ] }>;
    stderr: EventEmitter<{ data: [ chunk: Buffer ] }>;
    kill(signal: NodeJS.Signals): boolean;
};

/**
 * Simulates the `ssh` process without touching the network. Unlike a fake of
 * a one-shot execution, nothing is emitted on its own: the test drives the
 * child through `emitStdout`, `emitStderr`, `emitClose`, `emitExit` and
 * `emitError`,
 * because what `SpawnSSH` hands back is a live process, and the consumer only
 * subscribes to it once the promise resolves.
 */
export class SpawnSSHFake implements SpawnSSHInject {
    #options: { stdio: 'pipe'; cwd?: string; env?: NodeJS.ProcessEnv }[];
    get options(): readonly { stdio: 'pipe'; cwd?: string; env?: NodeJS.ProcessEnv }[] {
        return this.#options;
    }

    #calls: { program: string; args: string[] }[];
    get calls(): readonly { program: string; args: string[] }[] {
        return this.#calls;
    }

    #passwords: string[];
    get passwords(): readonly string[] {
        return this.#passwords;
    }

    #askPassOpened: number;
    get askPassOpened(): number {
        return this.#askPassOpened;
    }

    #askPassClosed: number;
    get askPassClosed(): number {
        return this.#askPassClosed;
    }

    #children: FakeChild[];
    get children(): readonly FakeChild[] {
        return this.#children;
    }

    #envs: (NodeJS.ProcessEnv | undefined)[];
    get envs(): readonly (NodeJS.ProcessEnv | undefined)[] {
        return this.#envs;
    }

    /** What the deadline was asked for, once per spawned child. */
    #timeouts: (number | undefined)[];
    get timeouts(): readonly (number | undefined)[] {
        return this.#timeouts;
    }

    #timeoutDisarmed: number;
    get timeoutDisarmed(): number {
        return this.#timeoutDisarmed;
    }

    #timeoutAttached: number;
    get timeoutAttached(): number {
        return this.#timeoutAttached;
    }

    /** The signals every child was killed with, in order. */
    #killed: NodeJS.Signals[];
    get killed(): readonly NodeJS.Signals[] {
        return this.#killed;
    }

    #expiries: (() => void)[];
    #spawnError: Error | null;
    #openError: Error | null;

    constructor() {
        this.#options       = [];
        this.#calls         = [];
        this.#passwords     = [];
        this.#askPassOpened = 0;
        this.#askPassClosed = 0;
        this.#children      = [];
        this.#envs          = [];
        this.#spawnError    = null;
        this.#openError     = null;
        this.#timeouts        = [];
        this.#timeoutDisarmed = 0;
        this.#timeoutAttached = 0;
        this.#expiries        = [];
        this.#killed          = [];
    }

    /** Resolves a child by index, where a negative one counts from the end. */
    #childAt(index: number): FakeChild {
        const child = this.#children.at(index);
        if (!child) {
            throw new Error(`There is no child process at the index ${index}.`);
        }

        return child;
    }

    #createChild(): FakeChild {
        return Object.assign(
            new EventEmitter<{
                'error': [ error: Error ];
                'close': [ code: number | null ];
                'exit':  [ code: number | null, signal: NodeJS.Signals | null ];
            }>(),
            {
                stdin:  new EventEmitter<{ data: [ chunk: Buffer ] }>(),
                stdout: new EventEmitter<{ data: [ chunk: Buffer ] }>(),
                stderr: new EventEmitter<{ data: [ chunk: Buffer ] }>(),
                kill: (signal: NodeJS.Signals): boolean => {
                    this.#killed.push(signal);
                    return true;
                }
            }
        );
    }

    /**
     * Double of the deadline. The real guard does the work — a timeout that
     * `SpawnSSH` should have refused is still refused here — and only the
     * clock is replaced, so the expiry is triggered rather than waited for.
     */
    timeoutGuard(timeout?: number): SpawnSSHTimeoutGuardHandler {
        this.#timeouts.push(timeout);

        const guard = new SpawnSSHTimeoutGuard(timeout, {
            schedule: (callback: () => void) => {
                this.#expiries.push(callback);
                return () => {};
            }
        });

        return {
            attach: child => {
                this.#timeoutAttached++;
                guard.attach(child);
            },
            disarm: () => {
                this.#timeoutDisarmed++;
                guard.disarm();
            }
        };
    }

    /** Fires a scheduled expiry, as the clock would have. */
    expireTimeout(index = -1): void {
        const expiry = this.#expiries.at(index);
        if (!expiry) {
            throw new Error(`There is nothing scheduled at the index ${index}.`);
        }

        expiry();
    }

    /** Makes the spawn itself fail, with the helper already listening. */
    failOnSpawn(error: Error): void {
        this.#spawnError = error;
    }

    /** Makes the credential provider fail before the process is spawned. */
    failOnOpen(error: Error): void {
        this.#openError = error;
    }

    emitStdout(chunk: string, index = -1): void {
        this.#childAt(index).stdout.emit('data', Buffer.from(chunk, 'utf-8'));
    }

    emitStderr(chunk: string, index = -1): void {
        this.#childAt(index).stderr.emit('data', Buffer.from(chunk, 'utf-8'));
    }

    emitClose(code: number | null, index = -1): void {
        this.#childAt(index).emit('close', code);
    }

    emitError(error: Error, index = -1): void {
        this.#childAt(index).emit('error', error);
    }

    /** A real child emits `exit` before `close`, so the tests can too. */
    emitExit(code: number | null, index = -1): void {
        this.#childAt(index).emit('exit', code, null);
    }

    /**
     * Double of the credential provider: it records the password it receives
     * and returns a recognizable environment, without setting up anything real.
     */
    askPass(): AskPassHandler {
        this.#askPassOpened++;
        return {
            open: async password => {
                if (this.#openError) { throw this.#openError; }
                this.#passwords.push(password);
                return {
                    SSH_ASKPASS_REQUIRE: 'force',
                    SSH_ASKPASS: '/tmp/fake/askpass.sh',
                    DISPLAY: ':0'
                };
            },
            close: async () => {
                this.#askPassClosed++;
            }
        };
    }

    spawn(
        program: string,
        args: string[],
        options: { stdio: 'pipe'; cwd?: string; env?: NodeJS.ProcessEnv }
    ): ChildProcessWithoutNullStreams {
        if (this.#spawnError) { throw this.#spawnError; }

        this.#calls.push({ program, args });
        this.#options.push(options);
        this.#envs.push(options?.env);

        const child = this.#createChild();
        this.#children.push(child);

        // The double only implements what is actually consumed, so the cast is
        // the price of honouring the real signature of `spawn`.
        return child as unknown as ChildProcessWithoutNullStreams;
    }
}

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AskPassHandler } from '../ask-pass/index.js';
import type { SpawnSSHInject } from './interfaces/index.js';

import { EventEmitter } from 'node:events';

/**
 * Shape of the double of the child process: only the surface `SpawnSSH` and
 * its consumers actually touch, so no real process nor socket is involved.
 */
type FakeChild = EventEmitter<{
    'error': [ error: Error ];
    'close': [ code: number | null ];
}> & {
    stdin:  EventEmitter<{ data: [ chunk: Buffer ] }>;
    stdout: EventEmitter<{ data: [ chunk: Buffer ] }>;
    stderr: EventEmitter<{ data: [ chunk: Buffer ] }>;
};

/**
 * Simulates the `ssh` process without touching the network. Unlike a fake of
 * a one-shot execution, nothing is emitted on its own: the test drives the
 * child through `emitStdout`, `emitStderr`, `emitClose` and `emitError`,
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

    #openError: Error | null;

    constructor() {
        this.#options       = [];
        this.#calls         = [];
        this.#passwords     = [];
        this.#askPassOpened = 0;
        this.#askPassClosed = 0;
        this.#children      = [];
        this.#envs          = [];
        this.#openError     = null;
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
            }>(),
            {
                stdin:  new EventEmitter<{ data: [ chunk: Buffer ] }>(),
                stdout: new EventEmitter<{ data: [ chunk: Buffer ] }>(),
                stderr: new EventEmitter<{ data: [ chunk: Buffer ] }>()
            }
        );
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

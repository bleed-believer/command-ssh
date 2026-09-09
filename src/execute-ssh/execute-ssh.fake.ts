import type { ExecuteSSHInject, SpawnSSHObject } from './interfaces/index.js';
import type { SpawnSSHOptions } from '../spawn-ssh/index.js';

import { EventEmitter } from 'node:events';

type FakeChild = EventEmitter<{
    error:  [ error: Error ];
    close:  [ code: number | null ];
}> & {
    stdout: EventEmitter<{ data: [ chunk: Buffer ] }>;
    stderr: EventEmitter<{ data: [ chunk: Buffer ] }>;
    stdin:  { end(): void };
};

export class ExecuteSSHFake implements ExecuteSSHInject {
    /**
     * Makes `spawn` reject instead of handing back a child, which is what a
     * real one does when the askpass helper cannot be set up.
     */
    #spawnError: Error | null;

    #options: SpawnSSHOptions[];
    get options(): readonly SpawnSSHOptions[] {
        return this.#options;
    }

    #calls: { program: string; args: string[] }[];
    get calls(): readonly { program: string; args: string[] }[] {
        return this.#calls;
    }

    #children: FakeChild[];
    get children(): readonly FakeChild[] {
        return this.#children;
    }

    /**
     * How many children had their stdin closed. An execution feeds nothing in,
     * so a remote command that reads its stdin only ever finishes because this
     * happened.
     */
    #stdinClosed: number;
    get stdinClosed(): number {
        return this.#stdinClosed;
    }

    constructor() {
        this.#spawnError = null;
        this.#stdinClosed = 0;
        this.#options    = [];
        this.#calls      = [];
        this.#children   = [];
    }

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
                error:  [ error: Error ];
                close:  [ code: number | null ];
            }>(),
            {
                stdout: new EventEmitter<{ data: [ chunk: Buffer ] }>(),
                stderr: new EventEmitter<{ data: [ chunk: Buffer ] }>(),
                stdin:  { end: () => { this.#stdinClosed++; } }
            }
        );
    }

    emitStdout(chunk: string | Buffer, index = -1): void {
        const data = typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk;
        this.#childAt(index).stdout.emit('data', data);
    }

    emitStderr(chunk: string | Buffer, index = -1): void {
        const data = typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk;
        this.#childAt(index).stderr.emit('data', data);
    }

    emitClose(code: number | null, index = -1): void {
        this.#childAt(index).emit('close', code);
    }

    emitError(error: Error, index = -1): void {
        this.#childAt(index).emit('error', error);
    }

    failSpawn(error: Error): void {
        this.#spawnError = error;
    }

    createSpawnSSH(options: SpawnSSHOptions): SpawnSSHObject {
        this.#options.push(options);
        return {
            spawn: async (program: string, args: string[]) => {
                this.#calls.push({ program, args });
                if (this.#spawnError) {
                    throw this.#spawnError;
                }

                const child = this.#createChild();
                this.#children.push(child);
                return child;
            }
        };
    }
}

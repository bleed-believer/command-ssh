import type { CommandSSHExecutor, CommandSSHSpawner, CommandSSHInject, CommandSSHOptions, EncodedExecutionResult, ExecutionResult } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { EventEmitter } from 'node:events';

/**
 * Shape of the double of the child process: only what a consumer of
 * `CommandSSH.spawn` would touch, so no real process nor socket is involved.
 */
type FakeChild = EventEmitter<{
    'error': [ error: Error ];
    'close': [ code: number | null ];
}> & {
    stdout: EventEmitter<{ data: [ chunk: Buffer ] }>;
    stderr: EventEmitter<{ data: [ chunk: Buffer ] }>;
};

/**
 * Stands in for both collaborators of `CommandSSH`, recording the options each
 * factory was handed and the calls each double received.
 *
 * `CommandSSH` only orchestrates: what is worth asserting here is *what it
 * forwards and what it hands back*, never how `ExecuteSSH` or `SpawnSSH`
 * behave — each of those answers for itself in its own test.
 */
export class CommandSSHFake implements CommandSSHInject {
    #executeCalls: { program: string; args: string[] }[];
    get executeCalls(): readonly { program: string; args: string[] }[] {
        return this.#executeCalls;
    }

    #spawnCalls: { program: string; args: string[] }[];
    get spawnCalls(): readonly { program: string; args: string[] }[] {
        return this.#spawnCalls;
    }

    #children: FakeChild[];
    get children(): readonly FakeChild[] {
        return this.#children;
    }

    #options: CommandSSHOptions[];
    get options(): readonly CommandSSHOptions[] {
        return this.#options;
    }

    #result: EncodedExecutionResult | ExecutionResult;
    #error: Error | null;

    constructor(result: EncodedExecutionResult | ExecutionResult = { code: 0 }) {
        this.#executeCalls = [];
        this.#spawnCalls   = [];
        this.#children     = [];
        this.#options      = [];
        this.#result       = result;
        this.#error        = null;
    }

    /** Makes whichever double is asked next fail instead of answering. */
    failWith(error: Error): void {
        this.#error = error;
    }

    createExecuteSSH(options: CommandSSHOptions): CommandSSHExecutor {
        this.#options.push(options);
        return {
            execute: async (program: string, ...args: string[]) => {
                this.#executeCalls.push({ program, args });
                if (this.#error) { throw this.#error; }

                return this.#result;
            }
        };
    }

    createSpawnSSH(options: CommandSSHOptions): CommandSSHSpawner {
        this.#options.push(options);
        return {
            spawn: async (program: string, args: string[]) => {
                this.#spawnCalls.push({ program, args });
                if (this.#error) { throw this.#error; }

                const child = Object.assign(
                    new EventEmitter<{
                        'error': [ error: Error ];
                        'close': [ code: number | null ];
                    }>(),
                    {
                        stdout: new EventEmitter<{ data: [ chunk: Buffer ] }>(),
                        stderr: new EventEmitter<{ data: [ chunk: Buffer ] }>()
                    }
                );

                this.#children.push(child);

                // The double only implements what is actually consumed, so the
                // cast is the price of honouring the real signature.
                return child as unknown as ChildProcessWithoutNullStreams;
            }
        };
    }
}

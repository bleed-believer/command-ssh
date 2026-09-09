import type { CommandSSHExecutor, CommandSSHSpawner, CommandSSHInject, EncodedExecutionResult, ExecutionResult } from './interfaces/index.js';
import type { ControlMasterHandler, ControlMasterOptions } from '../control-master/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ExecuteSSHOptions } from '../execute-ssh/index.js';

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

    #options: ExecuteSSHOptions[];
    get options(): readonly ExecuteSSHOptions[] {
        return this.#options;
    }

    #masters: ControlMasterOptions[];
    get masters(): readonly ControlMasterOptions[] {
        return this.#masters;
    }

    #opened: number;
    get opened(): number {
        return this.#opened;
    }

    #closed: number;
    get closed(): number {
        return this.#closed;
    }

    #result: EncodedExecutionResult | ExecutionResult;
    #openError: Error | null;
    #error: Error | null;
    #path: string | null;

    constructor(result: EncodedExecutionResult | ExecutionResult = { code: 0 }) {
        this.#executeCalls = [];
        this.#spawnCalls   = [];
        this.#children     = [];
        this.#options      = [];
        this.#masters      = [];
        this.#opened       = 0;
        this.#closed       = 0;
        this.#result       = result;
        this.#error        = null;
        this.#openError    = null;
        this.#path         = null;
    }

    /** Makes whichever double is asked next fail instead of answering. */
    failWith(error: Error): void {
        this.#error = error;
    }

    /** Makes the connection refuse to come up. */
    failOnConnect(error: Error): void {
        this.#openError = error;
    }

    /** Kills the connection from the outside, as a dying master would. */
    loseConnection(): void {
        this.#path = null;
    }

    createControlMaster(options: ControlMasterOptions): ControlMasterHandler {
        this.#masters.push(options);

        const fake = this;
        return {
            get path(): string | null {
                return fake.#path;
            },
            open: async () => {
                if (this.#openError) { throw this.#openError; }

                // As the real one: opening twice is not an error, and it is
                // still a single connection.
                if (this.#path) { return; }

                this.#opened++;
                this.#path = '/tmp/bb-command-ssh-000000/c';
            },
            close: async () => {
                this.#closed++;
                this.#path = null;
            }
        };
    }

    createExecuteSSH(options: ExecuteSSHOptions): CommandSSHExecutor {
        this.#options.push(options);
        return {
            execute: async (program: string, ...args: string[]) => {
                this.#executeCalls.push({ program, args });
                if (this.#error) { throw this.#error; }

                return this.#result;
            }
        };
    }

    createSpawnSSH(options: ExecuteSSHOptions): CommandSSHSpawner {
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

import type { CommandSSHOptions, EncodedExecutionResult, ExecutionResult } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { ExecuteSSH } from '../execute-ssh/index.js';
import { SpawnSSH } from '../spawn-ssh/index.js';

export class CommandSSH<O extends CommandSSHOptions> {
    #options: O;

    constructor(options: O) {
        this.#options = options;
    }

    async execute(
        program: string,
        ...args: string[]
    ): Promise<
        O['encoding'] extends BufferEncoding
        ?   EncodedExecutionResult
        :   ExecutionResult
    >;

    execute(
        program: string,
        ...args: string[]
    ): Promise<EncodedExecutionResult | ExecutionResult> {
        const executeSSH = new ExecuteSSH(this.#options);
        return executeSSH.execute(program, ...args);
    }

    spawn(
        program: string,
        ...args: string[]
    ): Promise<ChildProcessWithoutNullStreams> {
        const spawnSSH = new SpawnSSH(this.#options);
        return spawnSSH.spawn(program, args);
    }
}
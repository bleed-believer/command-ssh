import type { EncodedExecutionResult, ExecutionResult } from '../../execute-ssh/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * The surface of `ExecuteSSH` that `CommandSSH` actually reaches for.
 *
 * It is the *implementation* signature, with both result shapes in a union:
 * the conditional overload belongs to the public method that faces the caller,
 * and a double has no encoding to resolve it against.
 */
export interface CommandSSHExecutor {
    execute(
        program: string,
        ...args: string[]
    ): Promise<EncodedExecutionResult | ExecutionResult>;
}

/** The surface of `SpawnSSH` that `CommandSSH` actually reaches for. */
export interface CommandSSHSpawner {
    spawn(program: string, args: string[]): Promise<ChildProcessWithoutNullStreams>;
}

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AskPassHandler } from '../../ask-pass/index.js';

export interface SpawnSSHInject {
    spawn?: (
        program: string,
        args: string[],
        options: {
            stdio: 'pipe',
            cwd?: string;
            env?: NodeJS.ProcessEnv
        }
    ) => ChildProcessWithoutNullStreams;

    /**
     * Factory of the credential provider. One is created per `execute`, so
     * that two concurrent executions never share state.
     */
    askPass?: () => AskPassHandler;
}

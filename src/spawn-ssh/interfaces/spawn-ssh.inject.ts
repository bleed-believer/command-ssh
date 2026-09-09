import type { SpawnSSHTimeoutGuardHandler } from './spawn-ssh.timeout-guard.js';
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

    /**
     * Factory of the deadline. One per child as well, and built before the
     * process is: it is what refuses a timeout that makes no sense, and doing
     * that afterwards would leave an `ssh` already running behind it.
     */
    timeoutGuard?: (timeout?: number) => SpawnSSHTimeoutGuardHandler;
}

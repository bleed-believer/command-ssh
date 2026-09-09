import type { SpawnSSHTimeoutGuardHandler } from '../../spawn-ssh/index.js';
import type { ControlMasterReadyHandler } from './control-master.ready.js';
import type { ControlMasterSocketHandler } from './control-master.socket.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { LastResortHandler } from '../../last-resort/index.js';
import type { AskPassHandler } from '../../ask-pass/index.js';

export interface ControlMasterInject {
    /** Cleanup for the case the host process dies before the master does. */
    lastResort?: LastResortHandler;

    /**
     * Factory of the wait, built at `open` because it is the argv of the probe
     * — and therefore the socket — that it is waiting on.
     */
    ready?: (argv: string[], env: NodeJS.ProcessEnv) => ControlMasterReadyHandler;

    /** Deadline for the connection to come up, disarmed once it has. */
    timeoutGuard?: (timeout?: number) => SpawnSSHTimeoutGuardHandler;

    /** The private directory the socket lives in. */
    socket?: ControlMasterSocketHandler;

    /** Credential provider of the single authentication of the session. */
    askPass?: () => AskPassHandler;

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
     * Removes the directory **synchronously**, for the emergency cleanup
     * alone: a process on its way out never gets to resolve a promise.
     */
    rmSync?: (
        path: string,
        options: { recursive: true; force: true }
    ) => void;
}

import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * Contract of the piece that puts an upper bound on how long a spawned `ssh`
 * is allowed to live.
 */
export interface SpawnSSHTimeoutGuardHandler {
    attach(child: ChildProcessWithoutNullStreams): void;
    disarm(): void;
}

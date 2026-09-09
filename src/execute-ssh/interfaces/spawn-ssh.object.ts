import type { EventEmitter } from 'node:events';

/**
 * The slice of `SpawnSSH` that `ExecuteSSH` actually consumes: a child process
 * it reads to the end. Narrow on purpose, so a test double has to fake a pair
 * of streams and three events rather than a whole `ChildProcess`.
 *
 * The chunks are `Buffer` and not `any` because the child is always spawned
 * with `stdio: 'pipe'` and no encoding set on either stream, which is the one
 * case where Node hands over the bytes untouched.
 */
export interface SpawnSSHObject {
    spawn(program: string, args: string[]): Promise<
        EventEmitter<{
            error:  [ error: Error ];
            close:  [ code: number | null ];
        }> & {
            stdout: EventEmitter<{ data: [ chunk: Buffer ]; }>;
            stderr: EventEmitter<{ data: [ chunk: Buffer ]; }>;

            /**
             * Only ever closed, never written to: an execution captures output
             * and has nothing to feed in, but the remote command is entitled
             * to its EOF all the same.
             */
            stdin:  { end(): void };
        }
    >;
}

import type { EventEmitter } from 'node:events';

export interface SpawnSSHObject {
    spawn(program: string, args: string[]): Promise<
        EventEmitter<{
            error:  [ error: Error ];
            close:  [ code: number | null ];
        }> & {
            stdout: EventEmitter<{ data: [ chunk: any ]; }>;
            stderr: EventEmitter<{ data: [ chunk: any ]; }>;
        }
    >;
}
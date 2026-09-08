import type { SpawnSSHOptions } from '../../spawn-ssh/index.js';

export interface ExecuteSSHOptions extends SpawnSSHOptions {
    encoding?: BufferEncoding;
}
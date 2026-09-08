import type { SpawnSSHOptions } from '../../spawn-ssh/index.js';
import type { SpawnSSHObject } from './spawn-ssh.object.js';

export interface ExecuteSSHInject {
    createSpawnSSH?(options: SpawnSSHOptions): SpawnSSHObject;
}
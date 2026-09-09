import type { CommandSSHExecutor, CommandSSHSpawner } from './command-ssh.objects.js';
import type { ControlMasterHandler, ControlMasterOptions } from '../../control-master/index.js';
import type { ExecuteSSHOptions } from '../../execute-ssh/index.js';
import type { SpawnSSHOptions } from '../../spawn-ssh/index.js';

/**
 * The command factories take the *full* options, `controlPath` included: it is
 * `CommandSSH` that decides whether there is a connection to ride on, and the
 * collaborators only ever receive the answer.
 */
export interface CommandSSHInject {
    createExecuteSSH?(options: ExecuteSSHOptions): CommandSSHExecutor;
    createSpawnSSH?(options: SpawnSSHOptions): CommandSSHSpawner;

    /**
     * Unlike the other two this one is built **once**, and only when a
     * connection is actually asked for: the whole point of it is being shared
     * by every command that follows.
     */
    createControlMaster?(options: ControlMasterOptions): ControlMasterHandler;
}

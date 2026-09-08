import type { CommandSSHExecutor, CommandSSHSpawner } from './command-ssh.objects.js';
import type { CommandSSHOptions } from './command-ssh.options.js';

/**
 * Both are factories rather than instances: `CommandSSH` builds one per call,
 * so two concurrent commands never share an askpass helper nor a socket.
 */
export interface CommandSSHInject {
    createExecuteSSH?(options: CommandSSHOptions): CommandSSHExecutor;
    createSpawnSSH?(options: CommandSSHOptions): CommandSSHSpawner;
}

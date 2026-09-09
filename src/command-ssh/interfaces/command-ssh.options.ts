import type { ExecuteSSHOptions } from '../../execute-ssh/index.js';

/**
 * `controlPath` is deliberately not part of this: the socket of a reused
 * connection belongs to whoever opened it, and pointing at one somebody else
 * opened is handing them the command. `connect` is how a connection is asked
 * for here.
 */
export interface CommandSSHOptions extends Omit<ExecuteSSHOptions, 'controlPath'> {
    /**
     * Milliseconds `connect` is allowed to take to bring the connection up:
     * resolving the host, the handshake and the authentication. Defaults to
     * 20 000, and unlike `timeout` it cannot be left out — a connection that
     * never finishes coming up never says so.
     *
     * It has nothing to do with `timeout`, which bounds each command that runs
     * afterwards.
     */
    connectTimeout?: number;
}

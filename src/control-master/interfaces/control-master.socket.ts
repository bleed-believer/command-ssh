export interface ControlMasterSocketPaths {
    /** The private directory itself, which is what has to be removed. */
    directory: string;

    /** The socket inside it, which is what `ssh` is pointed at. */
    path: string;
}

/**
 * Contract of the private place where the multiplexed connection lives.
 *
 * Whoever can reach that socket can run commands through the connection
 * without ever authenticating: it is the credential, once the master has done
 * its part. So it is not a path — it is a path inside a directory no other
 * user can even list.
 */
export interface ControlMasterSocketHandler {
    create(): Promise<ControlMasterSocketPaths>;
    remove(): Promise<void>;
}

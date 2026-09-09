export interface SSHConfigOptions {
    hostKeyChecking?: 'accept-new' | 'yes' | 'no';
    legacyAlgorithms?: boolean;

    /** Only its presence matters here: the secret itself never reaches an argv. */
    password?: string;

    /** Socket of the multiplexed connection, when there is one in play. */
    controlPath?: string;

    /**
     * Whether this invocation is the one that owns the multiplexed connection
     * — the master that authenticates — rather than one of the commands that
     * ride on the socket it opened.
     */
    controlMaster?: boolean;
}

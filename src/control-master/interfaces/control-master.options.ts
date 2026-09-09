export interface ControlMasterOptions {
    hostname: string;
    username: string;

    /**
     * Password for interactive authentication. A reused connection is the one
     * place where it is asked for **once for the whole session** instead of
     * once per command: the master authenticates with it, the helper is torn
     * down the moment the connection is up, and every command after that rides
     * on the socket with no credential in play at all.
     */
    password?: string;

    /** @see SpawnSSHOptions.legacyAlgorithms */
    legacyAlgorithms?: boolean;

    /** @see SpawnSSHOptions.hostKeyChecking */
    hostKeyChecking?: 'accept-new' | 'yes' | 'no';

    /**
     * Milliseconds the connection is allowed to take to come up: resolving the
     * host, the handshake and the authentication. Defaults to 20 000.
     *
     * Unlike the timeout of a command there is no way to leave it out. A
     * master that never finishes authenticating never says so — it just sits
     * there — and the wait for it to be ready would have nothing to end it.
     */
    connectTimeout?: number;

    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

export interface AskPassScriptPaths {
    /** Executable that `ssh` will invoke as `SSH_ASKPASS`. */
    command: string;

    /** Path of the socket where the helper will go fetch the password. */
    socket: string;
}

/**
 * Contract of the on-disk helper. It materializes an executable that holds no
 * secret, only the instructions to request it over a private channel.
 */
export interface AskPassScriptHandler {
    create(): Promise<AskPassScriptPaths>;
    remove(): Promise<void>;
}

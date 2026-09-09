/**
 * Contract of a connection that is opened once and then handed to any number
 * of commands.
 */
export interface ControlMasterHandler {
    /**
     * Socket every command is pointed at, or `null` when there is no
     * connection to ride on — never opened, already closed, or dead.
     *
     * It going back to `null` on its own is the whole point of reading it
     * before each command. `ssh` falls back to a connection of its own when
     * the socket is not there, and a command that quietly re-authenticated
     * would undo, one at a time, everything the reuse was for.
     */
    readonly path: string | null;

    open(): Promise<void>;
    close(): Promise<void>;
}

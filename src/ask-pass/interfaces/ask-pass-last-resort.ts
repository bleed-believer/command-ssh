/**
 * Contract of the cleanup that only runs when the ordinary one no longer can.
 *
 * The helper lives in a temporary directory that the normal teardown removes
 * asynchronously once `ssh` is done. If the host process dies first, that
 * teardown never gets its turn and the directory outlives everyone, so a
 * protected path is one that must disappear synchronously on the way out.
 */
export interface AskPassLastResortHandler {
    /** Starts watching a directory, to be wiped if the process dies first. */
    protect(directory: string): void;

    /** Stops watching a directory the ordinary teardown already removed. */
    release(directory: string): void;
}

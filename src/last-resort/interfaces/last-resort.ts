/**
 * Contract of the cleanup that only runs when the ordinary one no longer can.
 *
 * Everything this library leaves behind while `ssh` is alive — a temporary
 * directory, a listening socket, a multiplexed connection already
 * authenticated — is removed asynchronously once `ssh` is done. If the host
 * process dies first, that teardown never gets its turn, so a protected
 * resource is one that must disappear **synchronously** on the way out.
 */
export interface LastResortHandler {
    /**
     * Starts watching a directory, to be cleaned up if the host process dies
     * first. The directory is the identity of the protection — what is
     * released later — and the cleanup is what actually has to happen: for a
     * helper that is wiping it, and for a multiplexed connection also killing
     * the master that owns the socket inside it.
     */
    protect(directory: string, cleanup: () => void): void;

    /** Stops watching a directory the ordinary teardown already dealt with. */
    release(directory: string): void;
}

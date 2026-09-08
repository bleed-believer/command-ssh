export interface AskPassLastResortInject {
    /**
     * Removes a whole directory tree **synchronously**: a process on its way
     * out never gets to resolve a promise.
     */
    rmSync?: (path: string, options: { recursive: true; force: true }) => void;

    /** How many handlers are still watching an event once ours is gone. */
    listenerCount?: (event: string) => number;

    /** Re-raises a signal with its default disposition back in place. */
    kill?: (signal: NodeJS.Signals) => void;

    /** Stops watching the end of the host process. */
    off?: (event: string, listener: () => void) => void;

    /** Starts watching the end of the host process. */
    on?: (event: string, listener: () => void) => void;
}

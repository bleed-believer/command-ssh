/**
 * Contract of the wait for the master to actually be up.
 *
 * There is nothing to listen for: a master is started with `-N`, so it runs no
 * remote command and prints nothing at all on success. What it does do is
 * answer `ssh -O check` once the connection is established, and that is the
 * only authoritative answer — the socket file shows up before the connection
 * behind it is usable.
 */
export interface ControlMasterReadyHandler {
    /**
     * Resolves once the master answers, and rejects with whatever `giveUp`
     * hands back the moment it hands back anything.
     *
     * `giveUp` is what bounds the wait: it reports the master having died —
     * a refused password, an unknown host key, a deadline that expired — and
     * without it there would be nothing to stop the polling of a socket that
     * is never going to answer.
     */
    wait(giveUp: () => Error | null): Promise<void>;
}

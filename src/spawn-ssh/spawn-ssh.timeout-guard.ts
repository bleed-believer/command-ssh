import type { SpawnSSHTimeoutGuardHandler, SpawnSSHTimeoutGuardInject } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * Puts an upper bound on how long a spawned `ssh` may live.
 *
 * The bound covers the whole thing — resolving the host, the handshake, the
 * authentication and the remote command — because from the outside those are
 * indistinguishable: a command that never returns looks exactly like a network
 * that swallowed the connection, and both are the same problem for the caller.
 *
 * When it expires the process is killed *and* an `error` is raised on it. The
 * kill alone would not do: the child would simply reach `close`, and a caller
 * awaiting an execution would be handed a perfectly ordinary result with a
 * null exit code, as if the command had merely been unlucky. The error is what
 * says a deadline was missed, and it is what an execution rejects with.
 *
 * `SIGTERM` and not `SIGKILL`: `ssh` handles it, and on its way out it tears
 * down the connection instead of leaving the remote end to notice on its own.
 */
export class SpawnSSHTimeoutGuard implements SpawnSSHTimeoutGuardHandler {
    #injected: Required<SpawnSSHTimeoutGuardInject>;
    #timeout: number | undefined;
    #cancel: (() => void) | null;

    /**
     * A timeout that is not a positive number of milliseconds is refused right
     * here, before anything is spawned. The alternative is a `setTimeout` that
     * quietly fires at once — or never — over a typo.
     */
    constructor(timeout?: number, inject?: SpawnSSHTimeoutGuardInject) {
        if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
            throw new Error(
                `Unusable timeout ${JSON.stringify(timeout)}, `
                + 'expected a positive number of milliseconds.'
            );
        }

        this.#timeout = timeout;
        this.#cancel  = null;
        this.#injected = {
            schedule: inject?.schedule?.bind(inject) ?? ((callback, ms) => {
                const timer = setTimeout(callback, ms);
                return () => clearTimeout(timer);
            })
        };
    }

    #expire(child: ChildProcessWithoutNullStreams, timeout: number): void {
        this.#cancel = null;

        const error = new Error(`The command timed out after ${timeout} ms.`);
        error.name = 'TimeoutError';

        // Killed before the error is raised, so that whoever handles it is
        // already looking at a process on its way out rather than at one still
        // holding a connection open.
        child.kill('SIGTERM');
        child.emit('error', error);
    }

    /**
     * With no timeout configured the guard is inert, which is what lets the
     * caller build one unconditionally instead of branching around it.
     */
    attach(child: ChildProcessWithoutNullStreams): void {
        const timeout = this.#timeout;
        if (timeout === undefined) { return; }

        this.#cancel = this.#injected.schedule(
            () => this.#expire(child, timeout),
            timeout
        );
    }

    /** Idempotent: the child may reach the end of its life more than one way. */
    disarm(): void {
        const cancel = this.#cancel;
        this.#cancel = null;
        cancel?.();
    }
}

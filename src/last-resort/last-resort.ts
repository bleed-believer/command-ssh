import type { LastResortHandler, LastResortInject } from './interfaces/index.js';

/**
 * Runs the cleanups that the ordinary teardown never got to run, because the
 * host process died before `ssh` did.
 *
 * Everything here is synchronous by necessity: once `exit` is being emitted
 * there is no event loop left to resolve a promise, so a queued `rm` would
 * simply never run. That is also why this is a *last* resort and not the
 * mechanism: it pulls a directory out from under an `ssh` that may still be
 * authenticating, and kills a connection that may still be carrying a command,
 * which is only ever the right call when the process that was supposed to be
 * driving them is already gone.
 */
export class LastResort implements LastResortHandler {
    /**
     * One registry for the whole process. Any number of executions can be in
     * flight, and every one of them adds its cleanup here instead of its own
     * pair of listeners, so no consumer ever meets a `MaxListenersExceeded`
     * warning that came from this library.
     *
     * Sharing is not only about listener counts. On a signal this class puts
     * the default disposition back and re-raises it, which ends the process:
     * a second registry would never get its turn, and whatever it was
     * protecting would survive the very death it was watching for.
     */
    static #shared: LastResort | null = null;
    static get shared(): LastResort {
        return LastResort.#shared ??= new LastResort();
    }

    /**
     * `exit` alone is not enough. A signal with no listener of its own kills
     * the process through its default disposition, and nothing in JavaScript
     * runs afterwards — `exit` handlers included. Ctrl+C being the single most
     * common way to stop a CLI, ignoring the signals would leave the whole
     * mechanism protecting only the cases that were never at risk.
     */
    static #signals: readonly NodeJS.Signals[] = [ 'SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT' ];

    #injected: Required<LastResortInject>;
    #listeners: Map<string, () => void>;
    #cleanups: Map<string, () => void>;
    #listening: boolean;

    constructor(inject?: LastResortInject) {
        this.#cleanups  = new Map();
        this.#listening = false;
        this.#injected  = {
            listenerCount: inject?.listenerCount?.bind(inject) ?? (event => process.listenerCount(event)),
            kill:          inject?.kill?.bind(inject)          ?? (signal => { process.kill(process.pid, signal); }),
            off:           inject?.off?.bind(inject)           ?? ((event, listener) => { process.off(event, listener); }),
            on:            inject?.on?.bind(inject)            ?? ((event, listener) => { process.on(event, listener); })
        };

        // One closure per event, built once: the same reference has to come
        // back at detach time, or the listeners would pile up forever.
        this.#listeners = new Map<string, () => void>([
            [ 'exit', () => this.#purge() ],
            ...LastResort.#signals.map(
                signal => [ signal, () => this.#onSignal(signal) ] as const
            )
        ]);
    }

    #onSignal(signal: NodeJS.Signals): void {
        this.#purge();

        // Ours are gone before the count is taken, so what is left is only
        // what the host process put there.
        this.#detach();
        if (this.#injected.listenerCount(signal) > 0) {
            // Someone else is watching: that handler owns what happens next,
            // and ending the process here would steal the decision from them.
            return;
        }

        // Nobody else was listening, so this signal was going to end the
        // process before this class got in the way. Put it back how it was,
        // instead of picking an exit code that was never ours to pick.
        this.#injected.kill(signal);
    }

    #detach(): void {
        if (!this.#listening) { return; }

        this.#listening = false;
        for (const [ event, listener ] of this.#listeners) {
            this.#injected.off(event, listener);
        }
    }

    /**
     * Nothing is watched while nothing is at risk: a consumer that never uses
     * a password nor a reused connection never gets a signal handler of ours,
     * and therefore never sees this class change how its process reacts to
     * Ctrl+C.
     */
    #attach(): void {
        if (this.#listening) { return; }

        this.#listening = true;
        for (const [ event, listener ] of this.#listeners) {
            this.#injected.on(event, listener);
        }
    }

    /**
     * One cleanup that throws must not cost the others their turn, and
     * throwing from an `exit` handler would only turn a leaked temporary file
     * into a crash on the way out.
     */
    #purge(): void {
        const cleanups = [ ...this.#cleanups.values() ];

        // Emptied before anything runs: a cleanup that ends up here again —
        // a signal handler of the host that exits, and so fires `exit` too —
        // must not find the same work waiting for it a second time.
        this.#cleanups.clear();

        for (const cleanup of cleanups) {
            try {
                cleanup();
            } catch { /* nothing left to do about it at this point */ }
        }
    }

    protect(directory: string, cleanup: () => void): void {
        this.#cleanups.set(directory, cleanup);
        this.#attach();
    }

    release(directory: string): void {
        this.#cleanups.delete(directory);
        if (this.#cleanups.size === 0) {
            this.#detach();
        }
    }
}

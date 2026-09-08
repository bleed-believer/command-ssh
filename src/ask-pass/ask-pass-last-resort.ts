import type { AskPassLastResortHandler, AskPassLastResortInject } from './interfaces/index.js';

import { rmSync } from 'node:fs';

/**
 * Wipes the helper directories that the ordinary teardown never got to remove,
 * because the host process died before `ssh` did.
 *
 * Everything here is synchronous by necessity: once `exit` is being emitted
 * there is no event loop left to resolve a promise, so a queued `rm` would
 * simply never run. That is also why this is a *last* resort and not the
 * mechanism: it removes the directory out from under an `ssh` that may still
 * be authenticating, which is only ever the right call when the process that
 * was supposed to be talking to it is already gone.
 */
export class AskPassLastResort implements AskPassLastResortHandler {
    /**
     * One registry for the whole process. Any number of executions can be in
     * flight, and every one of them adds its directory here instead of its own
     * pair of listeners, so no consumer ever meets a `MaxListenersExceeded`
     * warning that came from this library.
     */
    static #shared: AskPassLastResort | null = null;
    static get shared(): AskPassLastResort {
        return AskPassLastResort.#shared ??= new AskPassLastResort();
    }

    /**
     * `exit` alone is not enough. A signal with no listener of its own kills
     * the process through its default disposition, and nothing in JavaScript
     * runs afterwards — `exit` handlers included. Ctrl+C being the single most
     * common way to stop a CLI, ignoring the signals would leave the whole
     * mechanism protecting only the cases that were never at risk.
     */
    static #signals: readonly NodeJS.Signals[] = [ 'SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT' ];

    #injected: Required<AskPassLastResortInject>;
    #listeners: Map<string, () => void>;
    #directories: Set<string>;
    #listening: boolean;

    constructor(inject?: AskPassLastResortInject) {
        this.#directories = new Set();
        this.#listening   = false;
        this.#injected    = {
            listenerCount: inject?.listenerCount?.bind(inject) ?? (event => process.listenerCount(event)),
            rmSync:        inject?.rmSync?.bind(inject)        ?? rmSync,
            kill:          inject?.kill?.bind(inject)          ?? (signal => { process.kill(process.pid, signal); }),
            off:           inject?.off?.bind(inject)           ?? ((event, listener) => { process.off(event, listener); }),
            on:            inject?.on?.bind(inject)            ?? ((event, listener) => { process.on(event, listener); })
        };

        // One closure per event, built once: the same reference has to come
        // back at detach time, or the listeners would pile up forever.
        this.#listeners = new Map<string, () => void>([
            [ 'exit', () => this.#purge() ],
            ...AskPassLastResort.#signals.map(
                signal => [ signal, () => this.#onSignal(signal) ] as const
            )
        ]);
    }

    /**
     * One unremovable directory must not cost the others their cleanup, and
     * throwing from an `exit` handler would only turn a leaked temporary file
     * into a crash on the way out.
     */
    #purge(): void {
        for (const directory of this.#directories) {
            try {
                this.#injected.rmSync(directory, { recursive: true, force: true });
            } catch { /* nothing left to do about it at this point */ }
        }

        this.#directories.clear();
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
     * a password never gets a signal handler of ours, and therefore never sees
     * this class change how its process reacts to Ctrl+C.
     */
    #attach(): void {
        if (this.#listening) { return; }

        this.#listening = true;
        for (const [ event, listener ] of this.#listeners) {
            this.#injected.on(event, listener);
        }
    }

    protect(directory: string): void {
        this.#directories.add(directory);
        this.#attach();
    }

    release(directory: string): void {
        this.#directories.delete(directory);
        if (this.#directories.size === 0) {
            this.#detach();
        }
    }
}

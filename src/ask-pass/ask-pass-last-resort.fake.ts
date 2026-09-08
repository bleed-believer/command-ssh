import type { AskPassLastResortInject } from './interfaces/index.js';

/**
 * Double of everything this class does to the outside world: the file system
 * and the host process itself. It records what would have been removed and
 * which listeners are registered at any moment, and lets a test fire the end
 * of the process on demand, so nothing real ever has to die to prove that the
 * cleanup happens.
 */
export class AskPassLastResortFake implements AskPassLastResortInject {
    #removed: string[];
    get removed(): readonly string[] {
        return this.#removed;
    }

    #killed: NodeJS.Signals[];
    get killed(): readonly NodeJS.Signals[] {
        return this.#killed;
    }

    #listeners: Map<string, Set<() => void>>;
    get events(): readonly string[] {
        return [ ...this.#listeners.keys() ].filter(
            event => (this.#listeners.get(event)?.size ?? 0) > 0
        );
    }

    #foreign: Map<string, number>;
    #rmError: Error | null;

    constructor() {
        this.#listeners = new Map();
        this.#foreign   = new Map();
        this.#removed   = [];
        this.#killed    = [];
        this.#rmError   = null;
    }

    #setOf(event: string): Set<() => void> {
        let listeners = this.#listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.#listeners.set(event, listeners);
        }

        return listeners;
    }

    /** Makes a removal fail, to verify the rest still gets its turn. */
    failOnRemove(error: Error): void {
        this.#rmError = error;
    }

    /** Pretends the host process registered handlers of its own. */
    addForeign(event: string, count = 1): void {
        this.#foreign.set(event, (this.#foreign.get(event) ?? 0) + count);
    }

    /** Fires an event as the host process would on its way out. */
    emit(event: string): void {
        for (const listener of [ ...this.#setOf(event) ]) {
            listener();
        }
    }

    listenerCount(event: string): number {
        return this.#setOf(event).size + (this.#foreign.get(event) ?? 0);
    }

    kill(signal: NodeJS.Signals): void {
        this.#killed.push(signal);
    }

    rmSync(path: string): void {
        this.#removed.push(path);
        if (this.#rmError) { throw this.#rmError; }
    }

    off(event: string, listener: () => void): void {
        this.#setOf(event).delete(listener);
    }

    on(event: string, listener: () => void): void {
        this.#setOf(event).add(listener);
    }
}

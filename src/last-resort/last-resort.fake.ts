import type { LastResortInject } from './interfaces/index.js';

/**
 * Double of the only thing this class touches on the outside: the host process
 * itself. It records which listeners are registered at any moment and lets a
 * test fire the end of the process on demand, so nothing real ever has to die
 * to prove that the cleanups run.
 */
export class LastResortFake implements LastResortInject {
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

    constructor() {
        this.#listeners = new Map();
        this.#foreign   = new Map();
        this.#killed    = [];
    }

    #setOf(event: string): Set<() => void> {
        let listeners = this.#listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.#listeners.set(event, listeners);
        }

        return listeners;
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

    off(event: string, listener: () => void): void {
        this.#setOf(event).delete(listener);
    }

    on(event: string, listener: () => void): void {
        this.#setOf(event).add(listener);
    }
}

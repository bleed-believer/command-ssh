import type { SpawnSSHTimeoutGuardInject } from './interfaces/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { EventEmitter } from 'node:events';

/** Shape of the child double: only what the guard reaches for. */
type FakeChild = EventEmitter<{ 'error': [ error: Error ] }> & {
    kill(signal: NodeJS.Signals): boolean;
};

/**
 * Replaces the clock, so the expiry is something a test triggers rather than
 * something it waits for.
 */
export class SpawnSSHTimeoutGuardFake implements SpawnSSHTimeoutGuardInject {
    #scheduled: { ms: number; fire: () => void }[];
    get scheduled(): readonly { ms: number; fire: () => void }[] {
        return this.#scheduled;
    }

    #signals: NodeJS.Signals[];
    get signals(): readonly NodeJS.Signals[] {
        return this.#signals;
    }

    #cancelled: number;
    get cancelled(): number {
        return this.#cancelled;
    }

    constructor() {
        this.#scheduled = [];
        this.#cancelled = 0;
        this.#signals   = [];
    }

    /** A child that records the signals it is killed with. */
    createChild(): ChildProcessWithoutNullStreams {
        const child: FakeChild = Object.assign(
            new EventEmitter<{ 'error': [ error: Error ] }>(),
            {
                kill: (signal: NodeJS.Signals): boolean => {
                    this.#signals.push(signal);
                    return true;
                }
            }
        );

        // The double only implements the surface the guard touches, so the
        // cast is the price of honouring the real type of a child process.
        return child as unknown as ChildProcessWithoutNullStreams;
    }

    /** Fires a pending expiry, as the clock would have. */
    expire(index = -1): void {
        const pending = this.#scheduled.at(index);
        if (!pending) {
            throw new Error(`There is nothing scheduled at the index ${index}.`);
        }

        pending.fire();
    }

    schedule(callback: () => void, ms: number): () => void {
        this.#scheduled.push({ ms, fire: callback });
        return () => { this.#cancelled++; };
    }
}

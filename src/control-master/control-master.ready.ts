import type { ControlMasterReadyHandler, ControlMasterReadyInject } from './interfaces/index.js';

import { spawn } from 'node:child_process';

/**
 * Waits for the master to actually be up.
 *
 * There is nothing to listen for. A master runs with `-N`, so it executes no
 * remote command and says nothing at all when it succeeds, and the socket file
 * shows up before the connection behind it can carry anything. What answers
 * the question is `ssh -O check`, which asks the master itself — so the wait is
 * a poll, and the only honest way to write it.
 *
 * The polling is bounded by `giveUp` rather than by a count of its own: the
 * master carries the deadline, and the two things that end this wait are the
 * connection coming up and the master dying — of a refused password, of an
 * unknown host key, or of that deadline.
 */
export class ControlMasterReady implements ControlMasterReadyHandler {
    /**
     * Tight at first and slower after: a host on the same network answers in
     * a handful of milliseconds, and there is no reason to make the common
     * case wait for a round number. An authentication that takes its time
     * would otherwise cost hundreds of processes to find that out.
     */
    static #BACKOFF: readonly number[] = [ 25, 50, 100, 200, 400, 800 ];

    #injected: Required<ControlMasterReadyInject>;
    #env: NodeJS.ProcessEnv;
    #argv: string[];

    constructor(argv: string[], env: NodeJS.ProcessEnv, inject?: ControlMasterReadyInject) {
        this.#argv = argv;
        this.#env  = env;
        this.#injected = {
            schedule: inject?.schedule?.bind(inject) ?? ((callback, ms) => {
                const timer = setTimeout(callback, ms);
                return () => clearTimeout(timer);
            }),
            spawn: inject?.spawn?.bind(inject) ?? spawn
        };
    }

    #sleep(ms: number): Promise<void> {
        return new Promise<void>(resolve => {
            this.#injected.schedule(() => resolve(), ms);
        });
    }

    /**
     * `-O check` neither connects nor authenticates: it asks the socket, and
     * the socket only answers once there is a connection behind it.
     *
     * Anything other than a clean exit is read as "not yet" rather than as a
     * failure. A probe that cannot even be launched, or one that arrives
     * before the socket exists, says nothing about the master — and what does
     * have something to say about it is `giveUp`.
     */
    #probe(): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            let child;
            try {
                child = this.#injected.spawn('ssh', this.#argv, {
                    stdio: 'ignore',
                    env: this.#env
                });
            } catch {
                resolve(false);
                return;
            }

            child.once('error', () => resolve(false));
            child.once('close', code => resolve(code === 0));
        });
    }

    async wait(giveUp: () => Error | null): Promise<void> {
        for (let attempt = 0; ; attempt++) {
            const before = giveUp();
            if (before) { throw before; }

            if (await this.#probe()) { return; }

            // Asked again before sleeping: a master that died while the probe
            // was in flight must not cost the caller another delay to hear
            // about it.
            const after = giveUp();
            if (after) { throw after; }

            const { length } = ControlMasterReady.#BACKOFF;
            await this.#sleep(
                ControlMasterReady.#BACKOFF[Math.min(attempt, length - 1)] ?? 800
            );
        }
    }
}

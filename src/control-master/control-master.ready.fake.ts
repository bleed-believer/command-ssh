import type { ControlMasterReadyInject } from './interfaces/index.js';
import type { ChildProcess } from 'node:child_process';

import { EventEmitter } from 'node:events';

/** What a queued probe is made to answer with. */
type Answer = number | 'error' | 'throw';

/**
 * Double of the probe and of the clock. Every `ssh -O check` is answered from
 * a queue the test fills, and the delays between them are recorded instead of
 * waited for, so a poll that would take seconds takes none.
 */
export class ControlMasterReadyFake implements ControlMasterReadyInject {
    #probes: string[][];
    get probes(): readonly string[][] {
        return this.#probes;
    }

    #delays: number[];
    get delays(): readonly number[] {
        return this.#delays;
    }

    #envs: (NodeJS.ProcessEnv | undefined)[];
    get envs(): readonly (NodeJS.ProcessEnv | undefined)[] {
        return this.#envs;
    }

    #answers: Answer[];

    constructor(...answers: Answer[]) {
        this.#answers = [ ...answers ];
        this.#probes  = [];
        this.#delays  = [];
        this.#envs    = [];
    }

    /** Queues what the next probes are going to answer, in order. */
    answerWith(...answers: Answer[]): void {
        this.#answers.push(...answers);
    }

    /** The clock never really passes: the delay is recorded and skipped. */
    schedule(callback: () => void, ms: number): () => void {
        this.#delays.push(ms);
        callback();
        return () => {};
    }

    spawn(
        program: string,
        args: string[],
        options: { stdio: 'ignore'; env?: NodeJS.ProcessEnv }
    ): ChildProcess {
        this.#probes.push([ program, ...args ]);
        this.#envs.push(options.env);

        // An exhausted queue means "still not up", which is what keeps a test
        // from having to spell out every unsuccessful probe.
        const answer = this.#answers.shift() ?? 255;
        if (answer === 'throw') {
            throw new Error('spawn ssh EAGAIN');
        }

        const child = new EventEmitter();

        // A real child never answers within the same tick, and the listeners
        // are attached right after this returns.
        queueMicrotask(() => {
            if (answer === 'error') {
                child.emit('error', new Error('spawn ssh ENOENT'));
                return;
            }

            child.emit('close', answer);
        });

        // The double only implements what is actually consumed, so the cast is
        // the price of honouring the real signature of `spawn`.
        return child as unknown as ChildProcess;
    }
}

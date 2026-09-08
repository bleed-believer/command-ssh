import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * Guarantees that a teardown runs exactly once when a child process reaches
 * the end of its life, whatever the consumer does with the listeners of the
 * process it was handed.
 *
 * The hook is deliberately **not** a listener. Subscribing to `close` would
 * put the teardown inside the listener registry, and that registry is public:
 * a single `child.removeAllListeners()` — the kind of thing anyone writes to
 * clean up after themselves — would silently take the cleanup with it. So the
 * guard shadows the `emit` of that one instance instead, which is what makes
 * it undetachable.
 *
 * Staying out of the registry also keeps the process exactly as it was:
 * no extra `error` listener appears, so an unhandled `error` still throws as
 * loudly as before instead of being swallowed, and every listener the consumer
 * registers remains theirs alone to remove.
 */
export class TeardownGuard {
    /**
     * Any of the three means `ssh` is gone for good: `exit` when the process
     * dies, `close` when its streams follow, and `error` when it never got to
     * live at all. Whichever arrives first is enough, because the helper is
     * only needed while `ssh` is authenticating.
     */
    static #events: readonly (string | symbol)[] = [ 'close', 'exit', 'error' ];

    #child: ChildProcessWithoutNullStreams;
    #teardown: () => Promise<void>;
    #done: boolean;

    constructor(child: ChildProcessWithoutNullStreams, teardown: () => Promise<void>) {
        this.#child    = child;
        this.#teardown = teardown;
        this.#done     = false;
    }

    /**
     * A failed teardown is a leaked temporary directory at worst, and the
     * consumer has no way to react to it: letting it become an unhandled
     * rejection would take down a host process that did nothing wrong.
     */
    #run(): void {
        if (this.#done) { return; }

        this.#done = true;
        this.#teardown().catch(() => {});
    }

    attach(): void {
        // The overloads of `ChildProcess.emit` are there for the callers that
        // name an event; this one forwards whatever it gets, untouched.
        const emit = this.#child.emit.bind(this.#child) as
            (event: string | symbol, ...args: unknown[]) => boolean;

        // Shadowed on the instance, never on the prototype: it dies with this
        // very child, and every other one keeps the `emit` of `EventEmitter`.
        // Non-enumerable so the shape of the object stays as it was, and left
        // writable so a consumer wrapping `emit` for its own reasons is not
        // met with a `TypeError`.
        Object.defineProperty(this.#child, 'emit', {
            configurable: true,
            enumerable:   false,
            writable:     true,
            value: (event: string | symbol, ...args: unknown[]): boolean => {
                if (TeardownGuard.#events.includes(event)) {
                    // Before delegating: an `error` with no listener makes
                    // `emit` throw, and the helper must be gone all the same.
                    this.#run();
                }

                return emit(event, ...args);
            }
        });
    }
}

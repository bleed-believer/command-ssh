import type {
    AskPassChannelHandler,
    AskPassScriptHandler,
    AskPassScriptPaths,
    AskPassInject
} from './interfaces/index.js';

/**
 * Replaces the on-disk helper and the private channel with a pair of doubles
 * that only record what was asked of them, so the tests can verify the setup
 * order and that the teardown always happens.
 */
export class AskPassFake implements AskPassInject {
    #secrets: { path: string; secret: string }[];
    get secrets(): readonly { path: string; secret: string }[] {
        return this.#secrets;
    }

    #created: number;
    get created(): number {
        return this.#created;
    }

    #removed: number;
    get removed(): number {
        return this.#removed;
    }

    #closed: number;
    get closed(): number {
        return this.#closed;
    }

    #paths: AskPassScriptPaths;
    #openError: Error | null;
    #closeError: Error | null;

    channel: AskPassChannelHandler;
    script: AskPassScriptHandler;

    constructor(paths: AskPassScriptPaths = { command: '/tmp/x/askpass.sh', socket: '/tmp/x/s' }) {
        this.#paths      = paths;
        this.#secrets    = [];
        this.#created    = 0;
        this.#removed    = 0;
        this.#closed     = 0;
        this.#openError  = null;
        this.#closeError = null;

        this.script = {
            create: async () => {
                this.#created++;
                return this.#paths;
            },
            remove: async () => {
                this.#removed++;
            }
        };

        this.channel = {
            open: async (path, secret) => {
                if (this.#openError) { throw this.#openError; }
                this.#secrets.push({ path, secret });
            },
            close: async () => {
                this.#closed++;
                if (this.#closeError) { throw this.#closeError; }
            }
        };
    }

    /** Fails the channel opening, with the helper already put on disk. */
    failOnOpen(error: Error): void {
        this.#openError = error;
    }

    /** Fails the channel closing, to verify the helper is removed anyway. */
    failOnClose(error: Error): void {
        this.#closeError = error;
    }
}

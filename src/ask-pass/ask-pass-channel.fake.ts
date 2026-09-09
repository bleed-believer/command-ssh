import type { AskPassChannelSocket, AskPassChannelServer, AskPassChannelInject } from './interfaces/index.js';

/**
 * Simulated socket server. It allows triggering connections by hand and
 * capturing exactly which bytes were delivered to each one.
 */
export class AskPassChannelFake implements AskPassChannelInject {
    #listener: ((socket: AskPassChannelSocket) => void) | null;
    #delivered: Buffer[];
    get delivered(): readonly Buffer[] {
        return this.#delivered;
    }

    /**
     * The very buffers the channel handed over, as opposed to the copies in
     * `delivered`. Only a test verifying the wipe has any business here.
     */
    #handed: Buffer[];
    get handed(): readonly Buffer[] {
        return this.#handed;
    }

    #listening: string[];
    get listening(): readonly string[] {
        return this.#listening;
    }

    #closed: number;
    get closed(): number {
        return this.#closed;
    }

    #handlers: ((error: Error) => void)[];

    /**
     * How many `error` listeners the server is left with. The channel hooks
     * one to guard the opening, so anything that grows with each `open` is a
     * listener nobody is ever going to take off again.
     */
    get errorListeners(): number {
        return this.#handlers.length;
    }

    #error: Error | null;

    constructor() {
        this.#delivered = [];
        this.#listening = [];
        this.#handlers  = [];
        this.#handed    = [];
        this.#listener  = null;
        this.#error     = null;
        this.#closed    = 0;
    }

    /** Makes `listen` emit `error` instead of succeeding. */
    failWith(error: Error): void {
        this.#error = error;
    }

    /**
     * Simulates the server breaking down once it is already listening, which
     * is the case no promise is waiting for any more.
     */
    breakDown(error: Error): void {
        for (const handler of [ ...this.#handlers ]) {
            handler(error);
        }
    }

    /** Simulates the askpass helper connecting to ask for the secret. */
    connect(): Buffer {
        if (!this.#listener) {
            throw new Error('the server is not listening');
        }

        let received: Buffer = Buffer.alloc(0);
        this.#listener({
            end: (data, callback) => {
                this.#handed.push(data);

                // A real socket has the bytes on the wire before the callback
                // runs, so the copy has to be taken first: the callback is
                // exactly where the channel wipes the original.
                received = Buffer.from(data);
                callback?.();
            },
            on: () => {}
        });

        this.#delivered.push(received);
        return received;
    }

    createServer(listener: (socket: AskPassChannelSocket) => void): AskPassChannelServer {
        return {
            listen: (path, ready) => {
                queueMicrotask(() => {
                    if (this.#error) {
                        this.breakDown(this.#error);
                        return;
                    }

                    this.#listening.push(path);
                    this.#listener = listener;
                    ready();
                });
            },
            close: ready => {
                this.#listener = null;
                this.#closed++;
                queueMicrotask(ready);
            },

            // A real `EventEmitter` keeps every listener it is given, so a
            // double that kept only the last one would hide exactly the leak
            // these tests are here to catch.
            on: (_event, handler) => {
                this.#handlers.push(handler);
            },
            off: (_event, handler) => {
                const index = this.#handlers.indexOf(handler);
                if (index >= 0) {
                    this.#handlers.splice(index, 1);
                }
            }
        };
    }
}

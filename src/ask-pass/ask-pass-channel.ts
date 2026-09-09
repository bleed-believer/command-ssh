import type { AskPassChannelHandler, AskPassChannelServer, AskPassChannelInject } from './interfaces/index.js';

import { createServer } from 'node:net';

/**
 * Private channel that hands the secret over to the `SSH_ASKPASS` helper.
 *
 * The secret only ever exists in this process' memory and travels through a
 * UNIX socket living in a `0700` directory. It is never written to disk, and
 * never shows up in anyone's `argv` nor in `/proc/<pid>/environ`.
 *
 * It is delivered **once**. `ssh` needs the password while it authenticates,
 * which is the first instant of a command that may then run for hours, and a
 * channel that kept answering would keep the secret both reachable on the
 * socket and alive on the heap for all of it. After the single delivery the
 * buffer is wiped and later peers get nothing.
 */
export class AskPassChannel implements AskPassChannelHandler {
    /** Handed to a peer that arrives once the secret is already gone. */
    static #EMPTY = Buffer.alloc(0);

    #injected: Required<AskPassChannelInject>;
    #server: AskPassChannelServer | null;
    #secret: Buffer | null;

    constructor(inject?: AskPassChannelInject) {
        this.#server = null;
        this.#secret = null;
        this.#injected = {
            createServer: inject?.createServer?.bind(inject) ?? createServer
        };
    }

    async close(): Promise<void> {
        const server = this.#server;
        this.#server = null;

        // Normally already wiped, the moment it was delivered. This covers the
        // execution that never got that far: a spawn that failed, an `ssh`
        // that died before asking.
        this.#secret?.fill(0);
        this.#secret = null;

        if (!server) { return; }
        await new Promise<void>(resolve => server.close(() => resolve()));
    }

    async open(path: string, secret: string): Promise<void> {
        this.#secret = Buffer.from(`${secret}\n`, 'utf-8');

        const server = this.#injected.createServer(socket => {
            // A peer dying mid-delivery must not bring the host process
            // down with it.
            socket.on('error', () => {});

            const secret = this.#secret;
            if (!secret) {
                // Already delivered. `ssh` runs with `NumberOfPasswordPrompts=1`,
                // so it asks once and never again: whoever is asking now is not
                // the helper this channel was opened for.
                socket.end(AskPassChannel.#EMPTY);
                return;
            }

            // Taken before the write, not after: two peers arriving together
            // must not both find it here.
            this.#secret = null;
            socket.end(secret, () => secret.fill(0));
        });

        // The server only listens inside the private directory: a failure
        // here belongs to the host, not to a peer, and must propagate.
        await new Promise<void>((resolve, reject) => {
            const failed = (error: Error): void => reject(error);

            server.on('error', failed);
            server.listen(path, () => {
                // This listener only ever guarded the opening. Left behind it
                // would go on rejecting a promise that already settled, which
                // is a no-op: every later failure would vanish into it.
                server.off('error', failed);

                // What replaces it is a decision, not a leftover. Once the
                // channel is listening there is nobody left to reject to, and
                // an `error` with no listener at all takes the whole host
                // process down over a socket that only this class owns. The
                // failure is not silent either: `ssh` is left without its
                // password and fails to authenticate, loudly, on its own.
                server.on('error', () => {});
                resolve();
            });
        });

        this.#server = server;
    }
}

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
            server.on('error', reject);
            server.listen(path, resolve);
        });

        this.#server = server;
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
}

import type { AskPassChannelHandler, AskPassChannelServer, AskPassChannelInject } from './interfaces/index.js';

import { createServer } from 'node:net';

/**
 * Private channel that hands the secret over to the `SSH_ASKPASS` helper.
 *
 * The secret only ever exists in this process' memory and travels through a
 * UNIX socket living in a `0700` directory. It is never written to disk, and
 * never shows up in anyone's `argv` nor in `/proc/<pid>/environ`.
 */
export class AskPassChannel implements AskPassChannelHandler {
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
            if (this.#secret) {
                socket.end(this.#secret);
            }
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

        // Best-effort wipe: keeps the secret from outliving, on the heap, the
        // very execution that needed it.
        this.#secret?.fill(0);
        this.#secret = null;

        if (!server) { return; }
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

import type { AskPassScriptHandler, AskPassScriptPaths, AskPassScriptInject } from './interfaces/index.js';

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AskPassLastResort } from './ask-pass-last-resort.js';
import { ShellQuote } from '../shell-quote/index.js';

/**
 * Materializes the helper that `ssh` invokes as `SSH_ASKPASS`.
 *
 * The helper **holds no password**: all it knows is how to connect to a UNIX
 * socket and echo back through stdout whatever it receives. Everything lives
 * in a temporary directory created with `0700` permissions, so no other user
 * can even list the socket.
 */
export class AskPassScript implements AskPassScriptHandler {
    #injected: Required<AskPassScriptInject>;
    #directory: string | null;

    constructor(inject?: AskPassScriptInject) {
        this.#directory = null;
        this.#injected = {
            lastResort: inject?.lastResort ?? AskPassLastResort.shared,
            writeFile: inject?.writeFile?.bind(inject) ?? writeFile,
            mkdtemp:   inject?.mkdtemp?.bind(inject)   ?? mkdtemp,
            tmpdir:    inject?.tmpdir?.bind(inject)    ?? tmpdir,
            rm:        inject?.rm?.bind(inject)        ?? rm
        };
    }

    /**
     * The client running inside the helper. It takes the secret from the
     * socket and spits it out through stdout, the only thing `ssh` reads.
     */
    #clientOf(socket: string): string {
        return [
            `import { connect } from 'node:net';`,
            ``,
            `const socket = connect(${JSON.stringify(socket)});`,
            `const chunks = [];`,
            ``,
            `socket.on('data', chunk => chunks.push(chunk));`,
            `socket.on('error', () => process.exit(1));`,
            `socket.on('end', () => process.stdout.write(Buffer.concat(chunks)));`,
            ``
        ].join('\n');
    }

    async create(): Promise<AskPassScriptPaths> {
        const directory = await this.#injected.mkdtemp(
            join(this.#injected.tmpdir(), 'bb-command-ssh-')
        );

        // Claimed the moment it exists, and not once it is fully built: a
        // helper that fails halfway is still a directory somebody has to
        // remove, and from here on both cleanups know where to look.
        this.#directory = directory;
        this.#injected.lastResort.protect(directory);

        // The socket name is kept short on purpose: the full path of a UNIX
        // socket cannot go beyond ~108 bytes.
        const socket  = join(directory, 's');
        const client  = join(directory, 'askpass.mjs');
        const command = join(directory, 'askpass.sh');

        await this.#injected.writeFile(client, this.#clientOf(socket), { mode: 0o600 });
        await this.#injected.writeFile(
            command,
            `#!/bin/sh\nexec ${ShellQuote.of(process.execPath)} ${ShellQuote.of(client)}\n`,
            { mode: 0o700 }
        );

        return { command, socket };
    }

    async remove(): Promise<void> {
        if (!this.#directory) { return; }

        const directory = this.#directory;
        this.#directory = null;

        // Released first: whatever happens to the removal below, this
        // directory is no longer anybody's emergency.
        this.#injected.lastResort.release(directory);
        await this.#injected.rm(directory, { recursive: true, force: true });
    }
}

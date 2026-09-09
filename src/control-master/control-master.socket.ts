import type { ControlMasterSocketHandler, ControlMasterSocketPaths, ControlMasterSocketInject } from './interfaces/index.js';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The private place where the socket of a multiplexed connection lives.
 *
 * That socket is not a detail of the implementation: once the master has
 * authenticated, anyone who can reach it can run commands through the
 * connection without ever proving who they are. So it goes inside a directory
 * created with `0700` permissions, which no other user can even list, and it
 * is the directory — not the socket — that gets removed at the end.
 */
export class ControlMasterSocket implements ControlMasterSocketHandler {
    #injected: Required<ControlMasterSocketInject>;
    #directory: string | null;

    constructor(inject?: ControlMasterSocketInject) {
        this.#directory = null;
        this.#injected  = {
            mkdtemp: inject?.mkdtemp?.bind(inject) ?? mkdtemp,
            tmpdir:  inject?.tmpdir?.bind(inject)  ?? tmpdir,
            rm:      inject?.rm?.bind(inject)      ?? rm
        };
    }

    async create(): Promise<ControlMasterSocketPaths> {
        const directory = await this.#injected.mkdtemp(
            join(this.#injected.tmpdir(), 'bb-command-ssh-')
        );

        this.#directory = directory;

        // The socket name is a single character on purpose. `ssh` binds this
        // path as a UNIX socket, and the whole of it cannot go beyond ~108
        // bytes — a limit a long `TMPDIR` alone can get uncomfortably close to.
        return { directory, path: join(directory, 'c') };
    }

    /** Idempotent: a connection can reach its end more than one way. */
    async remove(): Promise<void> {
        if (!this.#directory) { return; }

        const directory = this.#directory;
        this.#directory = null;

        await this.#injected.rm(directory, { recursive: true, force: true });
    }
}

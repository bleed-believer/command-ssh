import type { CommandSSHOptions, CommandSSHInject, ExecutionResultOf, EncodedExecutionResult, ExecutionResult } from './interfaces/index.js';
import type { ControlMasterHandler } from '../control-master/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ExecuteSSHOptions } from '../execute-ssh/index.js';

import { ControlMaster } from '../control-master/index.js';
import { ExecuteSSH } from '../execute-ssh/index.js';
import { SpawnSSH } from '../spawn-ssh/index.js';

export class CommandSSH<O extends CommandSSHOptions> implements AsyncDisposable {
    #injected: Required<CommandSSHInject>;
    #master: ControlMasterHandler | null;
    #options: O;

    constructor(options: O, inject?: CommandSSHInject) {
        this.#injected = {
            createControlMaster: inject?.createControlMaster?.bind(inject) ?? (o => new ControlMaster(o)),
            createExecuteSSH:    inject?.createExecuteSSH?.bind(inject)    ?? (o => new ExecuteSSH(o)),
            createSpawnSSH:      inject?.createSpawnSSH?.bind(inject)      ?? (o => new SpawnSSH(o))
        };

        this.#master  = null;
        this.#options = options;
    }

    /**
     * The options a single command is run with, which is where the connection
     * — if there is one — gets handed over.
     *
     * With none, the options are the caller's own and every command opens a
     * connection of its own, exactly as if this class had no lifecycle at all.
     *
     * With one, the socket is read *per command* rather than remembered. `ssh`
     * falls back to a connection of its own when the socket is not there, so a
     * master that died would otherwise be paid for one silent re-authentication
     * at a time — undoing, command by command, the very thing `connect` was
     * asked for. Saying so out loud is the only honest answer left.
     */
    #optionsOf(): ExecuteSSHOptions {
        const master = this.#master;
        if (!master) { return this.#options; }

        const controlPath = master.path;
        if (!controlPath) {
            throw new Error(
                'The ssh connection asked for with connect() is not available: '
                + 'it failed to open, it was closed, or its master died.'
            );
        }

        return { ...this.#options, controlPath };
    }

    /**
     * Opens the connection every command from here on rides on, instead of
     * each of them opening one of their own.
     *
     * It is what turns the password into something asked for once per session
     * rather than once per command — which is not only faster, but the
     * difference between one authentication and ten against a host that counts
     * them. Calling it twice is not an error: there is one connection either
     * way.
     */
    async connect(): Promise<void> {
        const master = this.#master ??= this.#injected.createControlMaster(this.#options);
        await master.open();
    }

    async execute(
        program: string,
        ...args: string[]
    ): Promise<ExecutionResultOf<O>>;

    // `async`, so a connection that is gone is a rejection like any other
    // failure of a command, and never a throw the caller did not expect from
    // something that hands back a promise.
    async execute(
        program: string,
        ...args: string[]
    ): Promise<EncodedExecutionResult | ExecutionResult> {
        const executeSSH = this.#injected.createExecuteSSH(this.#optionsOf());
        return executeSSH.execute(program, ...args);
    }

    /**
     * Ends the connection `connect` opened, and hands back everything it was
     * holding: the master process, its private directory, the socket inside
     * it.
     *
     * Afterwards this is what it was before `connect` — commands go back to
     * opening a connection of their own — so the same instance can be
     * connected again later.
     */
    async close(): Promise<void> {
        const master = this.#master;
        this.#master = null;

        await master?.close();
    }

    async spawn(
        program: string,
        ...args: string[]
    ): Promise<ChildProcessWithoutNullStreams> {
        const spawnSSH = this.#injected.createSpawnSSH(this.#optionsOf());
        return spawnSSH.spawn(program, args);
    }

    /** What lets a connection be scoped with `await using`. */
    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }
}

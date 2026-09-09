import type { ControlMasterSocketPaths, ControlMasterReadyHandler, ControlMasterInject } from './interfaces/index.js';
import type { SpawnSSHTimeoutGuardHandler } from '../spawn-ssh/index.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AskPassHandler } from '../ask-pass/index.js';

import { SpawnSSHTimeoutGuard } from '../spawn-ssh/index.js';
import { EventEmitter } from 'node:events';

/** Only the surface of the master process that is actually touched. */
type FakeChild = EventEmitter<{
    'error': [ error: Error ];
    'close': [ code: number | null ];
    'exit':  [ code: number | null, signal: NodeJS.Signals | null ];
}> & {
    stderr: EventEmitter<{ data: [ chunk: Buffer ] }>;
    kill(signal: NodeJS.Signals): boolean;
};

/**
 * Simulates a multiplexed connection without opening one: no directory, no
 * socket, no process, no network.
 *
 * The wait for the connection to come up succeeds on its own, which is what
 * most tests are not about. `hold` switches it to a wait that stays pending
 * until the test makes it look again — the shape of a real poll, and the only
 * way to watch a master die halfway through one.
 */
export class ControlMasterFake implements ControlMasterInject {
    #protected: { directory: string; cleanup: () => void }[];
    get protected(): readonly { directory: string; cleanup: () => void }[] {
        return this.#protected;
    }

    #calls: { program: string; args: string[] }[];
    get calls(): readonly { program: string; args: string[] }[] {
        return this.#calls;
    }

    #probes: { argv: string[]; env: NodeJS.ProcessEnv }[];
    get probes(): readonly { argv: string[]; env: NodeJS.ProcessEnv }[] {
        return this.#probes;
    }

    #released: string[];
    get released(): readonly string[] {
        return this.#released;
    }

    #passwords: string[];
    get passwords(): readonly string[] {
        return this.#passwords;
    }

    #children: FakeChild[];
    get children(): readonly FakeChild[] {
        return this.#children;
    }

    #timeouts: (number | undefined)[];
    get timeouts(): readonly (number | undefined)[] {
        return this.#timeouts;
    }

    #removals: number;
    get removals(): number {
        return this.#removals;
    }

    #creations: number;
    get creations(): number {
        return this.#creations;
    }

    #askPassClosed: number;
    get askPassClosed(): number {
        return this.#askPassClosed;
    }

    #wiped: string[];
    get wiped(): readonly string[] {
        return this.#wiped;
    }

    #killed: NodeJS.Signals[];
    get killed(): readonly NodeJS.Signals[] {
        return this.#killed;
    }

    #envs: (NodeJS.ProcessEnv | undefined)[];
    get envs(): readonly (NodeJS.ProcessEnv | undefined)[] {
        return this.#envs;
    }

    #settle: { resolve: () => void; reject: (error: Error) => void } | null;
    #giveUp: (() => Error | null) | null;
    #expiries: (() => void)[];
    #spawnError: Error | null;
    #openError: Error | null;
    #directory: string;
    #holding: boolean;

    constructor(directory = '/tmp/bb-command-ssh-000000') {
        this.#directory     = directory;
        this.#protected     = [];
        this.#released      = [];
        this.#passwords     = [];
        this.#children      = [];
        this.#probes        = [];
        this.#calls         = [];
        this.#envs          = [];
        this.#wiped         = [];
        this.#killed        = [];
        this.#timeouts      = [];
        this.#expiries      = [];
        this.#removals      = 0;
        this.#creations     = 0;
        this.#askPassClosed = 0;
        this.#spawnError    = null;
        this.#openError     = null;
        this.#settle        = null;
        this.#giveUp        = null;
        this.#holding       = false;
    }

    /** The socket the fake connection would have been opened on. */
    get path(): string {
        return `${this.#directory}/c`;
    }

    #childAt(index: number): FakeChild {
        const child = this.#children.at(index);
        if (!child) {
            throw new Error(`There is no master process at the index ${index}.`);
        }

        return child;
    }

    /** Makes the wait stay pending, as a poll of a socket nobody answers. */
    hold(): void {
        this.#holding = true;
    }

    /** Makes the spawn of the master itself fail. */
    failOnSpawn(error: Error): void {
        this.#spawnError = error;
    }

    /** Makes the credential provider fail before the master is spawned. */
    failOnOpen(error: Error): void {
        this.#openError = error;
    }

    /** Fires the emergency cleanup of a directory, as a dying process would. */
    lastResortOf(directory: string): void {
        const entry = this.#protected.find(x => x.directory === directory);
        if (!entry) {
            throw new Error(`The directory ${directory} is not protected.`);
        }

        entry.cleanup();
    }

    /** Fires a scheduled expiry, as the clock would have. */
    expireTimeout(index = -1): void {
        const expiry = this.#expiries.at(index);
        if (!expiry) {
            throw new Error(`There is nothing scheduled at the index ${index}.`);
        }

        expiry();
    }

    /**
     * Makes a held wait look at the master once, the way a real one does
     * between probes: it gives up if the master is gone, and keeps waiting
     * otherwise.
     */
    poll(): void {
        const error = this.#giveUp?.() ?? null;
        if (error) {
            this.#settle?.reject(error);
            this.#settle = null;
        }
    }

    /** Lets a held wait find the connection up. */
    answer(): void {
        this.#settle?.resolve();
        this.#settle = null;
    }

    emitStderr(chunk: string, index = -1): void {
        this.#childAt(index).stderr.emit('data', Buffer.from(chunk, 'utf-8'));
    }

    emitExit(code: number | null, signal: NodeJS.Signals | null = null, index = -1): void {
        this.#childAt(index).emit('exit', code, signal);
    }

    emitError(error: Error, index = -1): void {
        this.#childAt(index).emit('error', error);
    }

    ready(argv: string[], env: NodeJS.ProcessEnv): ControlMasterReadyHandler {
        this.#probes.push({ argv, env });
        return {
            wait: async giveUp => {
                this.#giveUp = giveUp;

                const error = giveUp();
                if (error) { throw error; }
                if (!this.#holding) { return; }

                await new Promise<void>((resolve, reject) => {
                    this.#settle = { resolve, reject };
                });
            }
        };
    }

    /**
     * The real guard does the work — a deadline it should have refused is
     * still refused here — and only the clock is replaced.
     */
    timeoutGuard(timeout?: number): SpawnSSHTimeoutGuardHandler {
        this.#timeouts.push(timeout);

        const guard = new SpawnSSHTimeoutGuard(timeout, {
            schedule: (callback: () => void) => {
                this.#expiries.push(callback);
                return () => {};
            }
        });

        return guard;
    }

    get lastResort() {
        return {
            protect: (directory: string, cleanup: () => void): void => {
                this.#protected.push({ directory, cleanup });
            },
            release: (directory: string): void => {
                this.#released.push(directory);
            }
        };
    }

    get socket() {
        return {
            create: async (): Promise<ControlMasterSocketPaths> => {
                this.#creations++;
                return { directory: this.#directory, path: this.path };
            },
            remove: async (): Promise<void> => {
                this.#removals++;
            }
        };
    }

    askPass(): AskPassHandler {
        return {
            open: async password => {
                if (this.#openError) { throw this.#openError; }
                this.#passwords.push(password);
                return {
                    SSH_ASKPASS_REQUIRE: 'force',
                    SSH_ASKPASS: '/tmp/fake/askpass.sh',
                    DISPLAY: ':0'
                };
            },
            close: async () => {
                this.#askPassClosed++;
            }
        };
    }

    rmSync(path: string): void {
        this.#wiped.push(path);
    }

    spawn(
        program: string,
        args: string[],
        options: { stdio: 'pipe'; cwd?: string; env?: NodeJS.ProcessEnv }
    ): ChildProcessWithoutNullStreams {
        if (this.#spawnError) { throw this.#spawnError; }

        this.#calls.push({ program, args });
        this.#envs.push(options.env);

        const child = Object.assign(
            new EventEmitter<{
                'error': [ error: Error ];
                'close': [ code: number | null ];
                'exit':  [ code: number | null, signal: NodeJS.Signals | null ];
            }>(),
            {
                stderr: new EventEmitter<{ data: [ chunk: Buffer ] }>(),
                kill: (signal: NodeJS.Signals): boolean => {
                    this.#killed.push(signal);
                    return true;
                }
            }
        );

        this.#children.push(child);

        // The double only implements what is actually consumed, so the cast is
        // the price of honouring the real signature of `spawn`.
        return child as unknown as ChildProcessWithoutNullStreams;
    }
}

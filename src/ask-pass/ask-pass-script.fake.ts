import type { AskPassLastResortHandler, AskPassScriptInject } from './interfaces/index.js';

/**
 * In-memory file system. It records created directories, written files with
 * their permissions, and removed paths, so the tests can assert that the
 * helper ends up with the right modes and that it is cleaned up entirely.
 *
 * The emergency cleanup is a double as well, so no test ever registers a real
 * handler on the process running it.
 */
export class AskPassScriptFake implements AskPassScriptInject {
    #files: Map<string, { data: string; mode: number }>;
    get files(): ReadonlyMap<string, { data: string; mode: number }> {
        return this.#files;
    }

    #removed: string[];
    get removed(): readonly string[] {
        return this.#removed;
    }

    #prefixes: string[];
    get prefixes(): readonly string[] {
        return this.#prefixes;
    }

    #protected: string[];
    get protected(): readonly string[] {
        return this.#protected;
    }

    #released: string[];
    get released(): readonly string[] {
        return this.#released;
    }

    #temporary: string;
    #counter: number;

    lastResort: AskPassLastResortHandler;

    constructor(temporary = '/tmp') {
        this.#temporary = temporary;
        this.#prefixes  = [];
        this.#protected = [];
        this.#released  = [];
        this.#removed   = [];
        this.#counter   = 0;
        this.#files     = new Map();

        this.lastResort = {
            protect: directory => { this.#protected.push(directory); },
            release: directory => { this.#released.push(directory); }
        };
    }

    async writeFile(path: string, data: string, options: { mode: number }): Promise<void> {
        this.#files.set(path, { data, mode: options.mode });
    }

    async mkdtemp(prefix: string): Promise<string> {
        this.#prefixes.push(prefix);
        return `${prefix}${(this.#counter++).toString().padStart(6, '0')}`;
    }

    async rm(path: string): Promise<void> {
        this.#removed.push(path);
        for (const key of this.#files.keys()) {
            if (key.startsWith(`${path}/`)) {
                this.#files.delete(key);
            }
        }
    }

    tmpdir(): string {
        return this.#temporary;
    }
}

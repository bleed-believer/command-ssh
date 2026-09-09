import type { ControlMasterSocketInject } from './interfaces/index.js';

/** In-memory file system: it records what was created and what was removed. */
export class ControlMasterSocketFake implements ControlMasterSocketInject {
    #removed: string[];
    get removed(): readonly string[] {
        return this.#removed;
    }

    #prefixes: string[];
    get prefixes(): readonly string[] {
        return this.#prefixes;
    }

    #temporary: string;
    #counter: number;

    constructor(temporary = '/tmp') {
        this.#temporary = temporary;
        this.#prefixes  = [];
        this.#removed   = [];
        this.#counter   = 0;
    }

    async mkdtemp(prefix: string): Promise<string> {
        this.#prefixes.push(prefix);
        return `${prefix}${(this.#counter++).toString().padStart(6, '0')}`;
    }

    async rm(path: string): Promise<void> {
        this.#removed.push(path);
    }

    tmpdir(): string {
        return this.#temporary;
    }
}

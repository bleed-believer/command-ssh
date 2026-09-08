import { ShellQuote } from '../shell-quote/index.js';

/**
 * Turns a program and its arguments into the single string `ssh` hands to the
 * remote shell.
 *
 * There is no argv on the other side: `sshd` takes this string and runs it
 * through the login shell, so every argument has to arrive already quoted or
 * the remote shell will read whatever it contains — a space splits it in two,
 * a `;` starts another command, a `$(...)` runs one.
 *
 * `shell` opts out of that, and is the only way to get shell syntax across on
 * purpose. It is off by default: a caller passing user input as an argument
 * gets a literal argument, not an injection.
 */
export class SpawnSSHRemoteCommand {
    #program: string;
    #shell: boolean;
    #args: string[];

    constructor(program: string, args: string[], shell: boolean) {
        this.#program = program;
        this.#shell   = shell;
        this.#args    = args;
    }

    value(): string {
        const parts = [ this.#program, ...this.#args ];

        return this.#shell
            ? parts.join(' ')
            : parts.map(part => ShellQuote.of(part)).join(' ');
    }
}

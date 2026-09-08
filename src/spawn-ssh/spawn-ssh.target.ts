/**
 * Builds the `user@host` destination handed to `ssh`, and refuses to build one
 * that `ssh` would read as anything other than a destination.
 *
 * The argv separator `--` is what actually closes the option-injection hole:
 * with it in place a destination beginning with `-` is a bad hostname instead
 * of an option. This class exists for what the separator cannot give — a
 * failure the caller can understand. Without it, a `username` of
 * `-oProxyCommand=...` turns into `ssh: hostname contains invalid characters`,
 * which says nothing about where the value came from.
 *
 * The rules are deliberately permissive: anything rejected here is something
 * `ssh` could not have used anyway.
 */
export class SpawnSSHTarget {
    /**
     * Whitespace and control characters: never part of a real destination. A
     * `-` is *not* forbidden here — hostnames like `www.yani-neko.moe` need it
     * everywhere but the first character, which is checked on its own.
     */
    static #FORBIDDEN = /[\s\x00-\x1f\x7f]/;

    #hostname: string;
    #username: string;

    constructor(username: string, hostname: string) {
        this.#username = username;
        this.#hostname = hostname;
    }

    /**
     * A leading `-` is the shape of an `ssh` option, and it is rejected on both
     * halves: `username` carries it into the very first character of the argv
     * element, which is exactly what `ssh` looks at.
     */
    #check(label: string, value: string): void {
        if (value.length === 0) {
            throw new Error(`The ${label} cannot be empty.`);
        }

        if (SpawnSSHTarget.#FORBIDDEN.test(value)) {
            throw new Error(
                `The ${label} cannot contain whitespace nor control characters: ${JSON.stringify(value)}.`
            );
        }

        if (value.startsWith('-')) {
            throw new Error(
                `The ${label} cannot start with "-", or ssh would read it as an option: ${JSON.stringify(value)}.`
            );
        }
    }

    /**
     * `ssh` splits the destination on the **last** `@`, so an `@` inside the
     * hostname would silently move the boundary and hand the server a username
     * the caller never wrote.
     */
    value(): string {
        this.#check('username', this.#username);
        this.#check('hostname', this.#hostname);

        if (/[@/]/.test(this.#hostname)) {
            throw new Error(
                `The hostname cannot contain "@" nor "/": ${JSON.stringify(this.#hostname)}.`
            );
        }

        return `${this.#username}@${this.#hostname}`;
    }
}

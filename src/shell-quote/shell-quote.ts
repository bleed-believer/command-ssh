/**
 * Wraps a value so a POSIX shell reads it back as exactly one literal
 * argument, whatever it contains.
 *
 * Single quotes are the only shell quoting with no escapes inside them: every
 * character between them is literal, so nothing can start a substitution, end
 * a command, or split an argument. The one character that cannot appear is the
 * single quote itself, which is why it gets closed, escaped and reopened:
 * `'` becomes `'\''`.
 *
 * There is deliberately one of these for the whole library. Two shell-quoting
 * routines drifting apart is how an escaping bug becomes an injection.
 */
export class ShellQuote {
    static of(value: string): string {
        return `'${value.replaceAll(`'`, `'\\''`)}'`;
    }
}

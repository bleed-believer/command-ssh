/**
 * Contract of the credential provider for `ssh`. Its `open` returns the
 * environment variables to hand to the child process, which **never** carry
 * the password: they only point at the helper that knows how to ask for it.
 */
export interface AskPassHandler {
    open(password: string): Promise<NodeJS.ProcessEnv>;
    close(): Promise<void>;
}

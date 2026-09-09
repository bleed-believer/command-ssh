export interface SpawnSSHOptions {
    hostname: string;
    username: string;

    /**
     * Password for interactive authentication. It is handed to `ssh` through a
     * private in-memory channel: it is never written to disk, to the `argv`,
     * nor to the environment of any process.
     */
    password?: string;

    /**
     * Appends `ssh-rsa` to the end of the negotiable algorithm list, so it is
     * possible to talk to old servers that offer nothing more modern. Only
     * applies when authenticating with `password`. Defaults to `false`, so
     * nothing is negotiated down unless it is asked for explicitly.
     */
    legacyAlgorithms?: boolean;

    /**
     * What `ssh` does when the host key is not the one `known_hosts` expects.
     *
     * - `accept-new` (default) trusts a host it has never seen, and refuses one
     *   whose key changed. Convenient, and the reason it is not `yes`: it keeps
     *   a first connection from failing. It is still trust on first use — a
     *   man in the middle on that first connection is handed the password.
     * - `yes` refuses anything not already in `known_hosts`. The right setting
     *   once the host is known, and the recommended one when a `password` is
     *   involved.
     * - `no` accepts anything, every time. There is no authentication of the
     *   server left: only for hosts that are rebuilt constantly and reachable
     *   over a network you already trust.
     */
    hostKeyChecking?: 'accept-new' | 'yes' | 'no';

    /**
     * Hands the remote command over to the remote shell **unquoted**, so shell
     * syntax works: pipes, redirections, `&&`, globs, variable expansion.
     *
     * Defaults to `false`, which quotes the program and every argument, and is
     * the only safe setting for a command built from anything the caller did
     * not write itself. With `shell: true` an argument such as
     * `'hi; rm -rf ~'` is not an argument at all — it is a second command, and
     * it runs. Turn it on for a fixed script of your own, never for input.
     */
    shell?: boolean;

    /**
     * Milliseconds the whole thing is allowed to take: resolving the host, the
     * handshake, the authentication and the remote command. There is no
     * default, and without one a command that never returns never returns.
     *
     * On expiry the process is killed with `SIGTERM` and an `error` named
     * `TimeoutError` is raised on it. An execution rejects with it. A spawned
     * child hands it to whoever listens — and, as with any `error` of a child
     * process, nobody listening means it is thrown: a consumer that sets a
     * timeout owes the child an `error` listener.
     */
    timeout?: number;

    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

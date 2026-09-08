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

    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

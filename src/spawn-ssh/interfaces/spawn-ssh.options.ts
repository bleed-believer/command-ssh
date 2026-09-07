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

    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

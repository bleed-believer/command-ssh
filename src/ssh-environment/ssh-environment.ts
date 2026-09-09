/**
 * Builds the environment every `ssh` this library launches is handed.
 *
 * With no explicit `env` we must start from our own, or `ssh` ends up without
 * `HOME` (known_hosts) nor `PATH`.
 *
 * Whatever the source, any inherited `SSH_ASKPASS` is dropped: the helper
 * belongs to this library, so the environment of the consumer must never
 * decide who gets asked for a credential. An invocation that carries its own
 * helper overwrites both variables anyway, and one that carries none is left
 * with no helper at all instead of whatever the parent happened to export.
 */
export class SSHEnvironment {
    #env: NodeJS.ProcessEnv | undefined;

    constructor(env?: NodeJS.ProcessEnv) {
        this.#env = env;
    }

    /**
     * The askpass variables win over the inherited ones — that is the whole
     * point of them — except `DISPLAY`.
     *
     * `DISPLAY` is only a safety net for OpenSSH < 8.4, which consults the
     * helper solely when it believes it is in a graphical session. Any value
     * satisfies that belief, so a `DISPLAY` the caller already had does the job
     * just as well, and overwriting it would change what the child process sees
     * of the caller's own session for no gain.
     */
    value(askPass?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
        const env = { ...this.#env ?? process.env };

        delete env.SSH_ASKPASS_REQUIRE;
        delete env.SSH_ASKPASS;

        if (!askPass) { return env; }

        const merged = { ...env, ...askPass };
        if (env.DISPLAY) {
            merged.DISPLAY = env.DISPLAY;
        }

        return merged;
    }
}

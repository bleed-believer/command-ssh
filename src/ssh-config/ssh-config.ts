import type { SSHConfigOptions } from './interfaces/index.js';

/**
 * Builds the `-o` directives that decide how `ssh` authenticates and whom it
 * trusts.
 *
 * It exists so that there is exactly one of them. A multiplexed connection
 * runs `ssh` twice over — once for the master that authenticates, once per
 * command that rides on its socket — and these are precisely the flags that
 * must not drift apart between the two. A `BatchMode` fixed in one place and
 * forgotten in the other is a password prompt on a terminal nobody is
 * watching; a `StrictHostKeyChecking` fixed in one place and forgotten in the
 * other is a host key policy the caller did not ask for.
 */
export class SSHConfig {
    static #POLICIES: readonly string[] = [ 'accept-new', 'yes', 'no' ];

    #options: SSHConfigOptions;

    constructor(options: SSHConfigOptions) {
        this.#options = options;
    }

    /**
     * The union type is the contract, but a JavaScript consumer has no types:
     * an unknown value would reach `ssh` as an unknown config value, and how
     * `ssh` treats the host key from there is not something to leave to a
     * typo.
     */
    #hostKeyChecking(): 'accept-new' | 'yes' | 'no' {
        const policy = this.#options.hostKeyChecking ?? 'accept-new';
        if (!SSHConfig.#POLICIES.includes(policy)) {
            throw new Error(
                `Unknown hostKeyChecking ${JSON.stringify(policy)}, expected one of: `
                + SSHConfig.#POLICIES.join(', ') + '.'
            );
        }

        return policy;
    }

    /**
     * The socket comes first so that everything after it reads as what
     * happens *if the socket is not there*.
     *
     * `ControlPersist=no` is set only on the master, and only to override an
     * `ssh_config` of the consumer that asked for a lingering one: this
     * library kills its own master, and a connection that came back to life
     * in the background afterwards would be an authenticated session with
     * nobody left to own it.
     */
    #control(): string[] {
        const { controlPath, controlMaster } = this.#options;
        if (!controlPath) { return []; }

        const out = [
            '-o', `ControlPath=${controlPath}`,
            '-o', `ControlMaster=${controlMaster ? 'yes' : 'no'}`
        ];

        if (controlMaster) {
            out.push('-o', 'ControlPersist=no');
        }

        return out;
    }

    /**
     * A command riding on an existing socket authenticates nothing: the master
     * already did it, and the socket is the credential. So it asks for no
     * password even when one is configured — which is the whole point of
     * reusing the connection, the secret being needed once instead of once
     * per command.
     *
     * `BatchMode=yes` is what keeps that honest. If the socket is gone —
     * a master that died, a path that was never opened — `ssh` quietly falls
     * back to a connection of its own, and this is what makes that fallback
     * fail loudly instead of stopping to ask for a password on a terminal
     * nobody is watching.
     */
    #authentication(): string[] {
        const { password, controlPath, controlMaster } = this.#options;
        const policy = this.#hostKeyChecking();
        const multiplexed = !!controlPath && !controlMaster;

        if (multiplexed || !password) {
            return [
                '-o', 'BatchMode=yes',                    // never ask, just fail
                '-o', `StrictHostKeyChecking=${policy}`,
                '-o', 'ConnectTimeout=10'                 // don't hang on a dead network
            ];
        }

        // `+ssh-rsa` only appends the algorithm to the end of the list: with a
        // modern server the very same thing as always gets negotiated, and with
        // an old one the alternative was not being able to connect at all. It
        // stays opt-in, so nothing is negotiated down behind the caller's back.
        const legacy = this.#options.legacyAlgorithms
            ? [
                '-o', 'HostKeyAlgorithms=+ssh-rsa',
                '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa'
            ]
            : [];

        return [
            '-o', 'BatchMode=no',                     // enable the askpass helper
            '-o', `StrictHostKeyChecking=${policy}`,
            '-o', 'ConnectTimeout=10',
            '-o', 'NumberOfPasswordPrompts=1',        // don't retry the same password
            '-o', 'PubkeyAuthentication=no',          // go straight to the password
            '-o', 'PreferredAuthentications=password,keyboard-interactive',
            ...legacy
        ];
    }

    value(): string[] {
        return [ ...this.#control(), ...this.#authentication() ];
    }
}

import type { AskPassHandler, AskPassInject } from './interfaces/index.js';

import { AskPassChannel } from './ask-pass-channel.js';
import { AskPassScript } from './ask-pass-script.js';

/**
 * Assembles the whole `SSH_ASKPASS` mechanism: it puts the helper on disk and
 * opens the channel through which that helper will receive the password.
 *
 * `SSH_ASKPASS_REQUIRE=force` (OpenSSH >= 8.4) forces `ssh` to use the helper
 * even when a controlling terminal is available, which is exactly what saves
 * us from emulating a tty or depending on `sshpass`.
 */
export class AskPass implements AskPassHandler {
    #injected: Required<AskPassInject>;

    constructor(inject?: AskPassInject) {
        this.#injected = {
            channel: inject?.channel ?? new AskPassChannel(),
            script:  inject?.script  ?? new AskPassScript()
        };
    }

    async open(password: string): Promise<NodeJS.ProcessEnv> {
        const paths = await this.#injected.script.create();

        try {
            await this.#injected.channel.open(paths.socket, password);
        } catch (error) {
            await this.#injected.script.remove();
            throw error;
        }

        return {
            SSH_ASKPASS_REQUIRE: 'force',
            SSH_ASKPASS: paths.command,

            // Safety net for OpenSSH < 8.4, which only consults the helper
            // when it believes it is in a graphical session with no terminal.
            DISPLAY: ':0'
        };
    }

    async close(): Promise<void> {
        // The helper is always removed, even if closing the channel fails.
        try {
            await this.#injected.channel.close();
        } finally {
            await this.#injected.script.remove();
        }
    }
}

import type { AskPassLastResortHandler } from './ask-pass-last-resort.js';

export interface AskPassScriptInject {
    /**
     * Cleanup of the directory for the case the ordinary one never gets its
     * turn, because the host process died before `ssh` did.
     */
    lastResort?: AskPassLastResortHandler;

    writeFile?: (path: string, data: string, options: { mode: number }) => Promise<void>;
    mkdtemp?: (prefix: string) => Promise<string>;
    tmpdir?: () => string;
    rm?: (
        path: string,
        options: { recursive: true; force: true }
    ) => Promise<void>;
}

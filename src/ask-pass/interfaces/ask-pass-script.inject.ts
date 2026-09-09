import type { LastResortHandler } from '../../last-resort/index.js';

export interface AskPassScriptInject {
    /**
     * Cleanup of the directory for the case the ordinary one never gets its
     * turn, because the host process died before `ssh` did.
     */
    lastResort?: LastResortHandler;

    writeFile?: (path: string, data: string, options: { mode: number }) => Promise<void>;
    mkdtemp?: (prefix: string) => Promise<string>;
    tmpdir?: () => string;
    rm?: (
        path: string,
        options: { recursive: true; force: true }
    ) => Promise<void>;

    /**
     * Removes the directory **synchronously**, for the emergency cleanup
     * alone: a process on its way out never gets to resolve a promise.
     */
    rmSync?: (
        path: string,
        options: { recursive: true; force: true }
    ) => void;
}

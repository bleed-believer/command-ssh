import type { ChildProcess } from 'node:child_process';

export interface ControlMasterReadyInject {
    /**
     * The probe writes nothing and reads nothing: `stdio: 'ignore'` is what
     * says so, and it is why this hands back a plain `ChildProcess` rather
     * than one with streams attached.
     */
    spawn?: (
        program: string,
        args: string[],
        options: {
            stdio: 'ignore',
            env?: NodeJS.ProcessEnv
        }
    ) => ChildProcess;

    /** @see SpawnSSHTimeoutGuardInject.schedule */
    schedule?: (callback: () => void, ms: number) => () => void;
}

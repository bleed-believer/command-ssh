export interface ControlMasterSocketInject {
    mkdtemp?: (prefix: string) => Promise<string>;
    tmpdir?: () => string;
    rm?: (
        path: string,
        options: { recursive: true; force: true }
    ) => Promise<void>;
}

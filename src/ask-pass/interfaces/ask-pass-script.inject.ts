export interface AskPassScriptInject {
    writeFile?: (path: string, data: string, options: { mode: number }) => Promise<void>;
    mkdtemp?: (prefix: string) => Promise<string>;
    tmpdir?: () => string;
    rm?: (
        path: string,
        options: { recursive: true; force: true }
    ) => Promise<void>;
}

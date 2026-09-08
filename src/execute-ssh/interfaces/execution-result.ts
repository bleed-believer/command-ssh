export interface ExecutionResult {
    code: number | null;
    stdout?: Buffer;
    stderr?: Buffer;
}
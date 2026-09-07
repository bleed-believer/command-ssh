export interface AskPassChannelSocket {
    end(data: Buffer): void;
    on(event: 'error', listener: () => void): void;
}

export interface AskPassChannelServer {
    listen(path: string, listener: () => void): void;
    close(listener: () => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
}

/**
 * Contract of the private channel that delivers the secret in memory, without
 * it ever touching the disk, the `argv` or the environment of any process.
 */
export interface AskPassChannelHandler {
    open(path: string, secret: string): Promise<void>;
    close(): Promise<void>;
}

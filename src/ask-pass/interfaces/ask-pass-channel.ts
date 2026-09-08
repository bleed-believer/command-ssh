export interface AskPassChannelSocket {
    /**
     * The callback runs once the bytes are on the wire, which is the earliest
     * moment the buffer behind them can be wiped.
     */
    end(data: Buffer, callback?: () => void): void;
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

import type { AskPassChannelSocket, AskPassChannelServer } from './ask-pass-channel.js';

export interface AskPassChannelInject {
    createServer?: (
        listener: (socket: AskPassChannelSocket) => void
    ) => AskPassChannelServer;
}

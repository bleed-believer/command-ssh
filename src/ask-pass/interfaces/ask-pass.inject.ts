import type { AskPassChannelHandler } from './ask-pass-channel.js';
import type { AskPassScriptHandler } from './ask-pass-script.js';

export interface AskPassInject {
    channel?: AskPassChannelHandler;
    script?: AskPassScriptHandler;
}

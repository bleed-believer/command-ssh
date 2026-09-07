import { describe, it } from 'node:test';

import { AskPassChannelFake } from './ask-pass-channel.fake.js';
import { AskPassChannel } from './ask-pass-channel.js';

describe('AskPassChannel', () => {
    it('Listen on the requested socket path', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);

        await channel.open('/tmp/x/s', 'not-a-real-password');

        t.assert.deepStrictEqual(fake.listening, [ '/tmp/x/s' ]);
    });

    it('Deliver the secret with the trailing newline ssh expects', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);

        await channel.open('/tmp/x/s', 'not-a-real-password');

        t.assert.deepStrictEqual(fake.connect().toString('utf-8'), 'not-a-real-password\n');
    });

    it('Serve every prompt while the channel stays open', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);

        await channel.open('/tmp/x/s', 'not-a-real-password');
        fake.connect();
        fake.connect();

        t.assert.deepStrictEqual(
            fake.delivered.map(x => x.toString('utf-8')),
            [ 'not-a-real-password\n', 'not-a-real-password\n' ]
        );
    });

    it('Reject when the socket cannot be created', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);

        fake.failWith(new Error('EADDRINUSE'));
        await t.assert.rejects(() => channel.open('/tmp/x/s', 'not-a-real-password'), /EADDRINUSE/);
    });

    it('Stop serving after close', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);

        await channel.open('/tmp/x/s', 'not-a-real-password');
        await channel.close();

        t.assert.deepStrictEqual(fake.closed, 1);
        t.assert.throws(() => fake.connect(), /not listening/);
    });

    it('Wipe the secret buffer handed to the last prompt', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);
        const secret = 'not-a-real-password';

        await channel.open('/tmp/x/s', secret);
        const delivered = fake.connect();
        await channel.close();

        // The delivered buffer is the very one the channel keeps: once
        // closed, the secret is no longer in memory. Its size is the one of
        // the secret plus the newline ssh expects.
        t.assert.deepStrictEqual(
            delivered.toString('utf-8'),
            '\0'.repeat(secret.length + 1)
        );
    });

    it('Ignore a close without a previous open', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);

        await channel.close();

        t.assert.deepStrictEqual(fake.closed, 0);
    });
});

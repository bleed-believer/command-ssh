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

    it('Serve the secret once and never again', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);

        await channel.open('/tmp/x/s', 'not-a-real-password');
        fake.connect();
        fake.connect();
        fake.connect();

        // ssh asks once. Anyone asking afterwards is not the helper, and a
        // channel that answered them would be handing the password to
        // whatever else on this machine can reach the socket.
        t.assert.deepStrictEqual(
            fake.delivered.map(x => x.toString('utf-8')),
            [ 'not-a-real-password\n', '', '' ]
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

    it('Wipe the secret the moment it is delivered', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);
        const secret = 'not-a-real-password';

        await channel.open('/tmp/x/s', secret);
        const delivered = fake.connect();

        // The helper got the real bytes...
        t.assert.deepStrictEqual(delivered.toString('utf-8'), `${secret}\n`);

        // ...and nothing waited for the teardown: the buffer the channel was
        // holding is already zeroed, without closing anything.
        t.assert.deepStrictEqual(
            fake.handed[0]?.toString('utf-8'),
            '\0'.repeat(secret.length + 1)
        );
    });

    it('Wipe the secret on close when it was never asked for', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);
        const secret = 'not-a-real-password';

        // An ssh that died before authenticating never opens the socket, so
        // the delivery-time wipe never runs and the teardown owes it.
        await channel.open('/tmp/x/s', secret);
        await channel.close();

        t.assert.deepStrictEqual(fake.handed, []);
        t.assert.deepStrictEqual(fake.closed, 1);
    });

    it('Ignore a close without a previous open', async (t: it.TestContext) => {
        const fake = new AskPassChannelFake();
        const channel = new AskPassChannel(fake);

        await channel.close();

        t.assert.deepStrictEqual(fake.closed, 0);
    });
});

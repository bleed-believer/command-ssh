import { describe, it } from 'node:test';

import { AskPassFake } from './ask-pass.fake.js';
import { AskPass } from './ask-pass.js';

describe('AskPass', () => {
    it('Force ssh to use the helper instead of a terminal', async (t: it.TestContext) => {
        const fake = new AskPassFake({ command: '/tmp/x/askpass.sh', socket: '/tmp/x/s' });
        const askPass = new AskPass(fake);

        const env = await askPass.open('not-a-real-password');

        t.assert.deepStrictEqual(env.SSH_ASKPASS_REQUIRE, 'force');
        t.assert.deepStrictEqual(env.SSH_ASKPASS, '/tmp/x/askpass.sh');
    });

    it('Keep the password out of the environment handed to ssh', async (t: it.TestContext) => {
        const fake = new AskPassFake();
        const askPass = new AskPass(fake);

        const env = await askPass.open('not-a-real-password');

        t.assert.deepStrictEqual(
            Object.values(env).filter(x => x?.includes('not-a-real-password')),
            []
        );
    });

    it('Open the channel on the socket the helper will dial', async (t: it.TestContext) => {
        const fake = new AskPassFake({ command: '/tmp/x/askpass.sh', socket: '/tmp/x/s' });
        const askPass = new AskPass(fake);

        await askPass.open('not-a-real-password');

        t.assert.deepStrictEqual(fake.created, 1);
        t.assert.deepStrictEqual(fake.secrets, [ { path: '/tmp/x/s', secret: 'not-a-real-password' } ]);
    });

    it('Remove the helper when the channel fails to open', async (t: it.TestContext) => {
        const fake = new AskPassFake();
        const askPass = new AskPass(fake);

        fake.failOnOpen(new Error('EADDRINUSE'));
        await t.assert.rejects(() => askPass.open('not-a-real-password'), /EADDRINUSE/);
        t.assert.deepStrictEqual(fake.removed, 1);
    });

    it('Tear down both the channel and the helper', async (t: it.TestContext) => {
        const fake = new AskPassFake();
        const askPass = new AskPass(fake);

        await askPass.open('not-a-real-password');
        await askPass.close();

        t.assert.deepStrictEqual(fake.closed, 1);
        t.assert.deepStrictEqual(fake.removed, 1);
    });

    it('Remove the helper even when closing the channel throws', async (t: it.TestContext) => {
        const fake = new AskPassFake();
        const askPass = new AskPass(fake);

        await askPass.open('not-a-real-password');
        fake.failOnClose(new Error('EBADF'));

        await t.assert.rejects(() => askPass.close(), /EBADF/);
        t.assert.deepStrictEqual(fake.removed, 1);
    });
});

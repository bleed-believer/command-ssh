import { describe, it } from 'node:test';

import { SSHEnvironment } from './ssh-environment.js';

describe('SSHEnvironment', () => {
    it('Start from the environment of the host when none was given', async (t: it.TestContext) => {
        const env = new SSHEnvironment().value();

        // Without `HOME` there is no `known_hosts`, and without `PATH` there
        // is no `ssh` to find in the first place.
        t.assert.deepStrictEqual(env.PATH, process.env.PATH);
        t.assert.deepStrictEqual(env.HOME, process.env.HOME);
    });

    it('Take the environment the caller asked for, and only that', async (t: it.TestContext) => {
        const env = new SSHEnvironment({ LANG: 'es_CL.UTF-8' }).value();

        t.assert.deepStrictEqual(env, { LANG: 'es_CL.UTF-8' });
    });

    it('Never let the caller decide who is asked for a credential', async (t: it.TestContext) => {
        const env = new SSHEnvironment({
            PATH: '/usr/bin',
            SSH_ASKPASS: '/tmp/someone-elses-helper.sh',
            SSH_ASKPASS_REQUIRE: 'force'
        }).value();

        t.assert.deepStrictEqual(env.SSH_ASKPASS, undefined);
        t.assert.deepStrictEqual(env.SSH_ASKPASS_REQUIRE, undefined);
    });

    it('Let the helper of this library overwrite what was inherited', async (t: it.TestContext) => {
        const env = new SSHEnvironment({
            PATH: '/usr/bin',
            SSH_ASKPASS: '/tmp/someone-elses-helper.sh'
        }).value({
            SSH_ASKPASS_REQUIRE: 'force',
            SSH_ASKPASS: '/tmp/bb/askpass.sh',
            DISPLAY: ':0'
        });

        t.assert.deepStrictEqual(env.SSH_ASKPASS, '/tmp/bb/askpass.sh');
        t.assert.deepStrictEqual(env.SSH_ASKPASS_REQUIRE, 'force');
        t.assert.deepStrictEqual(env.PATH, '/usr/bin');
    });

    it('Keep the DISPLAY the caller already had', async (t: it.TestContext) => {
        const env = new SSHEnvironment({ DISPLAY: ':1' }).value({
            SSH_ASKPASS: '/tmp/bb/askpass.sh',
            DISPLAY: ':0'
        });

        // The session the caller pointed at is theirs: any value satisfies
        // the only thing `DISPLAY` is here for.
        t.assert.deepStrictEqual(env.DISPLAY, ':1');
    });

    it('Fall back to a DISPLAY when the caller had none', async (t: it.TestContext) => {
        const env = new SSHEnvironment({ PATH: '/usr/bin' }).value({
            SSH_ASKPASS: '/tmp/bb/askpass.sh',
            DISPLAY: ':0'
        });

        // OpenSSH < 8.4 only consults the helper when it believes there is a
        // graphical session to ask in.
        t.assert.deepStrictEqual(env.DISPLAY, ':0');
    });

    it('Never hand back the very object it was given', async (t: it.TestContext) => {
        const source = { PATH: '/usr/bin' };
        const env = new SSHEnvironment(source).value();

        env.LANG = 'es_CL.UTF-8';
        t.assert.deepStrictEqual(source, { PATH: '/usr/bin' });
    });
});

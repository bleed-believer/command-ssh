import { describe, it } from 'node:test';

import { SSHConfig } from './ssh-config.js';

describe('SSHConfig', () => {
    it('Never ask for anything when there is no password', async (t: it.TestContext) => {
        const config = new SSHConfig({});

        t.assert.deepStrictEqual(config.value(), [
            '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'ConnectTimeout=10'
        ]);
    });

    it('Open the way to the askpass helper when there is a password', async (t: it.TestContext) => {
        const config = new SSHConfig({ password: 'not-a-real-password' });

        t.assert.deepStrictEqual(config.value(), [
            '-o', 'BatchMode=no',
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'ConnectTimeout=10',
            '-o', 'NumberOfPasswordPrompts=1',
            '-o', 'PubkeyAuthentication=no',
            '-o', 'PreferredAuthentications=password,keyboard-interactive'
        ]);
    });

    it('Append the legacy algorithms only when they are asked for', async (t: it.TestContext) => {
        const asked = new SSHConfig({
            password: 'not-a-real-password',
            legacyAlgorithms: true
        });

        t.assert.deepStrictEqual(asked.value().slice(-4), [
            '-o', 'HostKeyAlgorithms=+ssh-rsa',
            '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa'
        ]);

        // Opt-in: nothing gets negotiated down behind the caller's back.
        const plain = new SSHConfig({ password: 'not-a-real-password' });
        t.assert.deepStrictEqual(plain.value().filter(x => x.includes('ssh-rsa')), []);
    });

    it('Leave the legacy algorithms out of a passwordless connection', async (t: it.TestContext) => {
        const config = new SSHConfig({ legacyAlgorithms: true });

        // There is no password path to be old-fashioned about: a key either
        // negotiates or it does not.
        t.assert.deepStrictEqual(config.value().filter(x => x.includes('ssh-rsa')), []);
    });

    it('Carry the host key policy into every shape of connection', async (t: it.TestContext) => {
        const cases = [
            new SSHConfig({ hostKeyChecking: 'yes' }),
            new SSHConfig({ hostKeyChecking: 'yes', password: 'not-a-real-password' }),
            new SSHConfig({ hostKeyChecking: 'yes', controlPath: '/tmp/bb/c' }),
            new SSHConfig({ hostKeyChecking: 'yes', controlPath: '/tmp/bb/c', controlMaster: true })
        ];

        for (const config of cases) {
            t.assert.ok(config.value().includes('StrictHostKeyChecking=yes'));
            t.assert.deepStrictEqual(
                config.value().filter(x => x.includes('accept-new')),
                []
            );
        }
    });

    it('Check the host key with accept-new by default', async (t: it.TestContext) => {
        t.assert.ok(new SSHConfig({}).value().includes('StrictHostKeyChecking=accept-new'));
    });

    it('Refuse a host key policy ssh would not understand', async (t: it.TestContext) => {
        // What a JavaScript consumer can reach the library with.
        const config = new SSHConfig({ hostKeyChecking: 'yeah' as unknown as 'yes' });

        t.assert.throws(() => config.value(), /hostKeyChecking/);
    });

    it('Say nothing about multiplexing when no socket is in play', async (t: it.TestContext) => {
        const config = new SSHConfig({ password: 'not-a-real-password' });

        t.assert.deepStrictEqual(config.value().filter(x => x.startsWith('Control')), []);
    });

    it('Own the connection when it is the master', async (t: it.TestContext) => {
        const config = new SSHConfig({
            password: 'not-a-real-password',
            controlPath: '/tmp/bb/c',
            controlMaster: true
        });

        const args = config.value();
        t.assert.deepStrictEqual(args.slice(0, 6), [
            '-o', 'ControlPath=/tmp/bb/c',
            '-o', 'ControlMaster=yes',
            '-o', 'ControlPersist=no'
        ]);

        // The master is the one that authenticates, so it still needs the
        // whole password path behind it.
        t.assert.ok(args.includes('BatchMode=no'));
        t.assert.ok(args.includes('PreferredAuthentications=password,keyboard-interactive'));
    });

    it('Ask for no credential at all when riding on an existing socket', async (t: it.TestContext) => {
        const config = new SSHConfig({
            password: 'not-a-real-password',
            controlPath: '/tmp/bb/c'
        });

        t.assert.deepStrictEqual(config.value(), [
            '-o', 'ControlPath=/tmp/bb/c',
            '-o', 'ControlMaster=no',
            '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'ConnectTimeout=10'
        ]);

        // The master already paid for the authentication: a command must not
        // ask for the password again, nor be able to.
        t.assert.deepStrictEqual(
            config.value().filter(x => x.includes('Authentication')),
            []
        );
    });

    it('Never let a command linger as a master of its own', async (t: it.TestContext) => {
        const config = new SSHConfig({ controlPath: '/tmp/bb/c' });

        // Only the master persists, and only the master is killed: a command
        // that promoted itself would outlive whoever asked for it.
        t.assert.ok(config.value().includes('ControlMaster=no'));
        t.assert.deepStrictEqual(
            config.value().filter(x => x.startsWith('ControlPersist')),
            []
        );
    });
});

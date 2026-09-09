import { describe, it } from 'node:test';

import { CommandSSHFake } from './command-ssh.fake.js';
import { CommandSSH } from './command-ssh.js';

describe('CommandSSH', () => {
    it('Forward the options untouched to the executor', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const options = {
            hostname: 'www.yani-neko.moe',
            username: 'yaniko',
            encoding: 'utf-8' as const
        };

        await new CommandSSH(options, fake).execute('ls');

        t.assert.deepStrictEqual(fake.options, [ options ]);
    });

    it('Forward the program and every argument to the executor', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko' },
            fake
        );

        await command.execute('ls', '-lua', '/tmp');

        t.assert.deepStrictEqual(fake.executeCalls, [
            { program: 'ls', args: [ '-lua', '/tmp' ] }
        ]);
    });

    it('Hand back the result of the executor untouched', async (t: it.TestContext) => {
        const expected = { code: 0, stdout: 'perreo', stderr: 'ijoeputa' };
        const fake = new CommandSSHFake(expected);
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko', encoding: 'utf-8' },
            fake
        );

        t.assert.deepStrictEqual(await command.execute('echo'), expected);
    });

    it('Let a failure of the executor reach the caller', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko' },
            fake
        );

        fake.failWith(new Error('The askpass helper failed to open'));
        await t.assert.rejects(() => command.execute('ls'), /askpass/);
    });

    it('Forward the options untouched to the spawner', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const options = { hostname: 'www.yani-neko.moe', username: 'yaniko' };

        await new CommandSSH(options, fake).spawn('ls');

        t.assert.deepStrictEqual(fake.options, [ options ]);
    });

    it('Collect the spawn arguments into the array SpawnSSH expects', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko' },
            fake
        );

        // The public API is variadic, the collaborator takes an array.
        await command.spawn('echo', 'perreo', 'ijoeputa');

        t.assert.deepStrictEqual(fake.spawnCalls, [
            { program: 'echo', args: [ 'perreo', 'ijoeputa' ] }
        ]);
    });

    it('Hand back the very child the spawner created', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko' },
            fake
        );

        const child = await command.spawn('ls');

        t.assert.deepStrictEqual(fake.children.length, 1);
        t.assert.deepStrictEqual(child as unknown, fake.children[0]);
    });

    it('Let a failure of the spawner reach the caller', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko' },
            fake
        );

        fake.failWith(new Error('The username cannot be empty'));
        await t.assert.rejects(() => command.spawn('ls'), /username/);
    });

    it('Build one collaborator per call, so two commands share no state', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko', password: 'not-a-real-password' },
            fake
        );

        await command.execute('ls');
        await command.execute('uptime');
        await command.spawn('tail', '-f', '/var/log/syslog');

        // One askpass helper and one socket each, never a shared one.
        t.assert.deepStrictEqual(fake.options.length, 3);
        t.assert.deepStrictEqual(fake.executeCalls.length, 2);
        t.assert.deepStrictEqual(fake.spawnCalls.length, 1);
    });

    it('Open no connection at all until one is asked for', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const options = { hostname: 'www.yani-neko.moe', username: 'yaniko' };

        await new CommandSSH(options, fake).execute('ls');

        // Without `connect` this behaves exactly as if it had no lifecycle:
        // the options reach the executor untouched, socket and all.
        t.assert.deepStrictEqual(fake.masters, []);
        t.assert.deepStrictEqual(fake.options, [ options ]);
    });

    it('Hand every command the socket of the connection that was opened', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const options = {
            hostname: 'www.yani-neko.moe',
            username: 'yaniko',
            password: 'not-a-real-password'
        };

        const command = new CommandSSH(options, fake);
        await command.connect();
        await command.execute('ls');
        await command.spawn('tail', '-f', '/var/log/syslog');

        t.assert.deepStrictEqual(fake.masters, [ options ]);
        t.assert.deepStrictEqual(fake.options, [
            { ...options, controlPath: '/tmp/bb-command-ssh-000000/c' },
            { ...options, controlPath: '/tmp/bb-command-ssh-000000/c' }
        ]);
    });

    it('Authenticate once for the whole session, not once per command', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await command.connect();
        await command.connect();
        await command.execute('ls');
        await command.execute('uptime');

        // Ten commands against a host that counts logins is how an account
        // gets locked out.
        t.assert.deepStrictEqual(fake.masters.length, 1);
        t.assert.deepStrictEqual(fake.opened, 1);
    });

    it('Let a connection that refuses to come up reach the caller', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko' },
            fake
        );

        fake.failOnConnect(new Error('Permission denied (password).'));
        await t.assert.rejects(() => command.connect(), /Permission denied/);
    });

    it('Refuse to run anything once the connection is gone', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await command.connect();
        fake.loseConnection();

        // `ssh` would quietly open a connection of its own instead, paying for
        // the authentication all over again, one command at a time.
        await t.assert.rejects(() => command.execute('ls'), /connection .* is not available/);
        await t.assert.rejects(() => command.spawn('ls'), /connection .* is not available/);
        t.assert.deepStrictEqual(fake.options, []);
    });

    it('End the connection on close', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko' },
            fake
        );

        await command.connect();
        await command.close();

        t.assert.deepStrictEqual(fake.closed, 1);
    });

    it('Go back to a connection per command once it is closed', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const options = { hostname: 'www.yani-neko.moe', username: 'yaniko' };
        const command = new CommandSSH(options, fake);

        await command.connect();
        await command.close();
        await command.execute('ls');

        // `close` is the inverse of `connect`, so what is left is what there
        // was before it.
        t.assert.deepStrictEqual(fake.options, [ options ]);
    });

    it('Connect again after a close', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko' },
            fake
        );

        await command.connect();
        await command.close();
        await command.connect();

        t.assert.deepStrictEqual(fake.opened, 2);
        t.assert.deepStrictEqual(fake.masters.length, 2);
    });

    it('Tolerate a close of something that was never connected', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();
        const command = new CommandSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko' },
            fake
        );

        await command.close();

        t.assert.deepStrictEqual(fake.closed, 0);
        t.assert.deepStrictEqual(fake.masters, []);
    });

    it('End the connection when the scope it was used in ends', async (t: it.TestContext) => {
        const fake = new CommandSSHFake();

        {
            await using command = new CommandSSH(
                { hostname: 'www.yani-neko.moe', username: 'yaniko' },
                fake
            );

            await command.connect();
            await command.execute('ls');
            t.assert.deepStrictEqual(fake.closed, 0);
        }

        t.assert.deepStrictEqual(fake.closed, 1);
    });
});

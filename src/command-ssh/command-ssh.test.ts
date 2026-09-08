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
});

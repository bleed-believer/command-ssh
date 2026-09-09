import { describe, it } from 'node:test';

import { SpawnSSHFake } from './spawn-ssh.fake.js';
import { SpawnSSH } from './spawn-ssh.js';

describe('SpawnSSH', () => {
    it('Build a non-interactive argv', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        t.assert.deepStrictEqual(fake.calls.length, 1);
        t.assert.deepStrictEqual(fake.calls[0], {
            program: 'ssh',
            args: [
                '-o', 'BatchMode=yes',
                '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'ConnectTimeout=10',
                '--',
                'yaniko@www.yani-neko.moe',
                `'ls' '-lua'`
            ]
        });
    });

    it('Assemble the remote command with every argument', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        await spawnSSH.spawn('echo', [ 'perreo', 'ijoeputa' ]);

        t.assert.deepStrictEqual(fake.calls[0]?.args.at(-1), `'echo' 'perreo' 'ijoeputa'`);
    });

    it('Assemble a remote command with no arguments at all', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        await spawnSSH.spawn('uptime');

        t.assert.deepStrictEqual(fake.calls[0]?.args.at(-1), `'uptime'`);
    });

    it('Neutralize shell syntax smuggled into an argument', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        await spawnSSH.spawn('echo', [ 'hi; id > /tmp/pwned' ]);

        // One argument on the far side, not a second command.
        t.assert.deepStrictEqual(
            fake.calls[0]?.args.at(-1),
            `'echo' 'hi; id > /tmp/pwned'`
        );
    });

    it('Hand the remote command over untouched when the shell is opted into', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                shell: true
            },
            fake
        );

        await spawnSSH.spawn('cd /tmp && ls');

        t.assert.deepStrictEqual(fake.calls[0]?.args.at(-1), 'cd /tmp && ls');
    });

    it('Quote the remote command when the shell is explicitly disabled', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                shell: false
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        t.assert.deepStrictEqual(fake.calls[0]?.args.at(-1), `'ls' '-lua'`);
    });

    it('Close the options with -- so no destination can become one', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        await spawnSSH.spawn('ls');

        const args = fake.calls[0]?.args ?? [];
        t.assert.deepStrictEqual(args.at(-3), '--');
        t.assert.deepStrictEqual(args.at(-2), 'yaniko@www.yani-neko.moe');
    });

    it('Refuse to spawn when the username would be read as an ssh option', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: '-oProxyCommand=touch /tmp/pwn'
            },
            fake
        );

        await t.assert.rejects(() => spawnSSH.spawn('ls'), /username/);

        // Nothing was launched: the check happens before any process exists.
        t.assert.deepStrictEqual(fake.calls, []);
    });

    it('Check the host key with accept-new by default', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            { hostname: 'www.yani-neko.moe', username: 'yaniko' },
            fake
        );

        await spawnSSH.spawn('ls');

        t.assert.ok(fake.calls[0]?.args.includes('StrictHostKeyChecking=accept-new'));
    });

    it('Refuse an unknown host key when asked to be strict', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password',
                hostKeyChecking: 'yes'
            },
            fake
        );

        await spawnSSH.spawn('ls');

        t.assert.ok(fake.calls[0]?.args.includes('StrictHostKeyChecking=yes'));
        t.assert.deepStrictEqual(
            fake.calls[0]?.args.filter(x => x.includes('accept-new')),
            []
        );
    });

    it('Carry the host key policy into the password branch too', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password',
                hostKeyChecking: 'no'
            },
            fake
        );

        await spawnSSH.spawn('ls');

        t.assert.ok(fake.calls[0]?.args.includes('StrictHostKeyChecking=no'));
    });

    it('Refuse a host key policy ssh would not understand', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                // What a JavaScript consumer can reach the library with.
                hostKeyChecking: 'yeah' as unknown as 'yes'
            },
            fake
        );

        await t.assert.rejects(() => spawnSSH.spawn('ls'), /hostKeyChecking/);
        t.assert.deepStrictEqual(fake.calls, []);
    });

    it('Ride an existing socket instead of opening a connection', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                controlPath: '/tmp/bb-command-ssh-000000/c'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        t.assert.deepStrictEqual(fake.calls[0], {
            program: 'ssh',
            args: [
                '-o', 'ControlPath=/tmp/bb-command-ssh-000000/c',
                '-o', 'ControlMaster=no',
                '-o', 'BatchMode=yes',
                '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'ConnectTimeout=10',
                '--',
                'yaniko@www.yani-neko.moe',
                `'ls' '-lua'`
            ]
        });
    });

    it('Ask for no password at all when riding an existing socket', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password',
                controlPath: '/tmp/bb-command-ssh-000000/c'
            },
            fake
        );

        await spawnSSH.spawn('ls');

        // The master already paid for the authentication. Setting up a helper
        // here would put the secret back on the heap, and on a socket, once
        // per command — for nothing.
        t.assert.deepStrictEqual(fake.askPassOpened, 0);
        t.assert.deepStrictEqual(fake.passwords, []);
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS, undefined);
        t.assert.ok(fake.calls[0]?.args.includes('BatchMode=yes'));
    });

    it('Keep the deadline over a command that rides an existing socket', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                controlPath: '/tmp/bb-command-ssh-000000/c',
                timeout: 1000
            },
            fake
        );

        const child = await spawnSSH.spawn('sleep', [ '90' ]);
        const errors: Error[] = [];
        child.on('error', error => errors.push(error));

        fake.expireTimeout();

        // Multiplexed or not, a command that never returns never returns.
        t.assert.deepStrictEqual(fake.killed, [ 'SIGTERM' ]);
        t.assert.deepStrictEqual(errors[0]?.name, 'TimeoutError');
    });

    it('Keep the DISPLAY the caller already had', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password',
                env: { PATH: '/usr/bin', DISPLAY: ':1' }
            },
            fake
        );

        await spawnSSH.spawn('ls');

        // The askpass helper is still forced, but the session the caller
        // pointed at is theirs.
        t.assert.deepStrictEqual(fake.envs[0]?.DISPLAY, ':1');
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS, '/tmp/fake/askpass.sh');
    });

    it('Fall back to a DISPLAY when the caller had none', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password',
                env: { PATH: '/usr/bin' }
            },
            fake
        );

        await spawnSSH.spawn('ls');

        // OpenSSH < 8.4 only consults the helper when it believes there is a
        // graphical session to ask in.
        t.assert.deepStrictEqual(fake.envs[0]?.DISPLAY, ':0');
    });

    it('Hand back the very same child the spawn created', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        const child = await spawnSSH.spawn('ls', [ '-lua' ]);

        t.assert.deepStrictEqual(fake.children.length, 1);
        t.assert.deepStrictEqual(child as unknown, fake.children[0]);
    });

    it('Pipe every stream of the child process', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        // Without `pipe` the consumer would have no stdout/stderr to read.
        t.assert.deepStrictEqual(fake.options[0]?.stdio, 'pipe');
    });

    it('Forward the cwd and the environment to the child process', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                cwd: '/home/yaniko',
                env: { LANG: 'es_CL.UTF-8' }
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        t.assert.deepStrictEqual(fake.options[0]?.cwd, '/home/yaniko');
        t.assert.deepStrictEqual(fake.envs[0], { LANG: 'es_CL.UTF-8' });
    });

    it('Stream what the child writes to the consumer', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        const child = await spawnSSH.spawn('ls', [ '-lua' ]);
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on('data', (c: Buffer) => stdout.push(c));
        child.stderr.on('data', (c: Buffer) => stderr.push(c));

        fake.emitStdout('perreo ');
        fake.emitStdout('ijoeputa\n');
        fake.emitStderr('algo salio mal\n');

        t.assert.deepStrictEqual(
            Buffer.concat(stdout).toString('utf-8'),
            'perreo ijoeputa\n'
        );
        t.assert.deepStrictEqual(
            Buffer.concat(stderr).toString('utf-8'),
            'algo salio mal\n'
        );
    });

    it('Forward to the consumer an error of the spawn itself', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        const child = await spawnSSH.spawn('ls', [ '-lua' ]);
        const errors: Error[] = [];
        child.on('error', err => errors.push(err));

        fake.emitError(new Error('spawn ssh ENOENT'));

        t.assert.deepStrictEqual(errors.length, 1);
        t.assert.match(errors[0]?.message ?? '', /ENOENT/);
    });

    it('Build an argv that lets ssh reach the askpass helper', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password',
                legacyAlgorithms: true
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        t.assert.deepStrictEqual(fake.calls[0], {
            program: 'ssh',
            args: [
                '-o', 'BatchMode=no',
                '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'ConnectTimeout=10',
                '-o', 'NumberOfPasswordPrompts=1',
                '-o', 'PubkeyAuthentication=no',
                '-o', 'PreferredAuthentications=password,keyboard-interactive',
                '-o', 'HostKeyAlgorithms=+ssh-rsa',
                '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa',
                '--',
                'yaniko@www.yani-neko.moe',
                `'ls' '-lua'`
            ]
        });
    });

    it('Drop the legacy algorithms when they are disabled', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password',
                legacyAlgorithms: false
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        t.assert.deepStrictEqual(
            fake.calls[0]?.args.filter(x => x.includes('ssh-rsa')),
            []
        );
    });

    it('Leave out the legacy algorithms by default', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        // They are opt-in: nothing gets negotiated down unless it is asked for.
        t.assert.deepStrictEqual(
            fake.calls[0]?.args.filter(x => x.includes('ssh-rsa')),
            []
        );
    });

    it('Never leak the password into the argv nor the environment', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        t.assert.deepStrictEqual(
            fake.calls[0]?.args.filter(x => x.includes('not-a-real-password')),
            []
        );
        t.assert.deepStrictEqual(
            Object.values(fake.envs[0] ?? {}).filter(x => x?.includes('not-a-real-password')),
            []
        );
    });

    it('Hand the password to the askpass provider instead', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        t.assert.deepStrictEqual(fake.passwords, [ 'not-a-real-password' ]);
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS, '/tmp/fake/askpass.sh');
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS_REQUIRE, 'force');
    });

    it('Merge the askpass environment with the given one', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password',
                env: { LANG: 'es_CL.UTF-8' }
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        t.assert.deepStrictEqual(fake.envs[0], {
            LANG: 'es_CL.UTF-8',
            SSH_ASKPASS_REQUIRE: 'force',
            SSH_ASKPASS: '/tmp/fake/askpass.sh',
            DISPLAY: ':0'
        });
    });

    it('Inherit the parent environment with no password either', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        // Both paths hand ssh the same environment: the only difference is the
        // askpass helper merged on top of it.
        t.assert.deepStrictEqual(fake.envs[0]?.PATH, process.env.PATH);
        t.assert.deepStrictEqual(fake.envs[0]?.HOME, process.env.HOME);
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS, undefined);
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS_REQUIRE, undefined);
    });

    it('Drop an askpass helper inherited from the parent environment', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                env: {
                    PATH: '/usr/bin',
                    SSH_ASKPASS: '/usr/lib/ssh/somebody-elses-askpass',
                    SSH_ASKPASS_REQUIRE: 'force'
                }
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        // Whoever spawned us may already export an askpass helper. With no
        // password there is nothing to answer with, so ssh must not be pointed
        // at a stranger's helper: the variables are dropped, not forwarded.
        t.assert.deepStrictEqual(fake.envs[0]?.PATH, '/usr/bin');
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS, undefined);
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS_REQUIRE, undefined);
    });

    it('Replace an inherited askpass helper with its own', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password',
                env: {
                    PATH: '/usr/bin',
                    SSH_ASKPASS: '/usr/lib/ssh/somebody-elses-askpass',
                    SSH_ASKPASS_REQUIRE: 'never'
                }
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        // The inherited `never` would have silenced our own helper, so nothing
        // of the parent's askpass setup may survive the merge.
        t.assert.deepStrictEqual(fake.envs[0]?.PATH, '/usr/bin');
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS, '/tmp/fake/askpass.sh');
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS_REQUIRE, 'force');
    });

    it('Inherit the parent environment when none is given', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        // With no PATH nor HOME, ssh cannot even find its own known_hosts.
        t.assert.deepStrictEqual(fake.envs[0]?.PATH, process.env.PATH);
        t.assert.deepStrictEqual(fake.envs[0]?.HOME, process.env.HOME);
    });

    it('Never set up an askpass helper when there is no password', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        const child = await spawnSSH.spawn('ls', [ '-lua' ]);
        fake.emitClose(0);

        t.assert.deepStrictEqual(fake.askPassOpened, 0);
        t.assert.deepStrictEqual(fake.askPassClosed, 0);
        t.assert.deepStrictEqual(fake.passwords, []);
        t.assert.deepStrictEqual(child as unknown, fake.children[0]);
    });

    it('Keep the askpass helper alive while the child is running', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);
        fake.emitStdout('total 0\n');

        // The helper answers the prompt of a process that is still alive.
        t.assert.deepStrictEqual(fake.askPassOpened, 1);
        t.assert.deepStrictEqual(fake.askPassClosed, 0);
    });

    it('Tear down the askpass helper once the child closes', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);
        fake.emitClose(0);

        t.assert.deepStrictEqual(fake.askPassClosed, 1);
    });

    it('Deliver the close event to the consumer as well', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        const child = await spawnSSH.spawn('ls', [ '-lua' ]);
        const codes: (number | null)[] = [];
        child.on('close', code => codes.push(code));

        // The teardown rides on the very emit that carries the event, so the
        // consumer must still be notified, and with the untouched code.
        fake.emitClose(255);

        t.assert.deepStrictEqual(codes, [ 255 ]);
        t.assert.deepStrictEqual(fake.askPassClosed, 1);
    });

    it('Create one askpass helper per spawned process', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);
        await spawnSSH.spawn('uptime');

        t.assert.deepStrictEqual(fake.askPassOpened, 2);
        t.assert.deepStrictEqual(fake.passwords, [ 'not-a-real-password', 'not-a-real-password' ]);

        // Closing one process leaves the other one untouched.
        fake.emitClose(0, 0);
        t.assert.deepStrictEqual(fake.askPassClosed, 1);

        fake.emitClose(0, 1);
        t.assert.deepStrictEqual(fake.askPassClosed, 2);
    });

    it('Reject without spawning when the askpass helper fails to open', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        fake.failOnOpen(new Error('EADDRINUSE'));
        await t.assert.rejects(
            () => spawnSSH.spawn('ls', [ '-lua' ]),
            /EADDRINUSE/
        );

        t.assert.deepStrictEqual(fake.calls, []);
        t.assert.deepStrictEqual(fake.children.length, 0);

        // Half a helper is still a helper: whatever it got to build has to be
        // torn down, the secret on the heap included.
        t.assert.deepStrictEqual(fake.askPassClosed, 1);
    });

    it('Tear down the askpass helper even if the consumer wipes every listener', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        const child = await spawnSSH.spawn('ls', [ '-lua' ]);

        // The credential outlives a careless cleanup: a live socket is exactly
        // what must never be left behind.
        child.removeAllListeners();
        fake.emitClose(0);

        t.assert.deepStrictEqual(fake.askPassClosed, 1);
    });

    it('Tear down the askpass helper even if the consumer wipes the close listeners', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        const child = await spawnSSH.spawn('ls', [ '-lua' ]);
        child.removeAllListeners('close');
        fake.emitClose(0);

        t.assert.deepStrictEqual(fake.askPassClosed, 1);
    });

    it('Tear down the askpass helper as soon as the child exits', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        // A real child emits `exit` before `close`, and by then `ssh` is gone:
        // there is nothing left to authenticate.
        fake.emitExit(0);
        t.assert.deepStrictEqual(fake.askPassClosed, 1);

        // And the `close` that follows must not tear anything down twice.
        fake.emitClose(0);
        t.assert.deepStrictEqual(fake.askPassClosed, 1);
    });

    it('Tear down the askpass helper when the child never got to live', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        const child = await spawnSSH.spawn('ls', [ '-lua' ]);
        child.on('error', () => {});
        fake.emitError(new Error('ENOENT'));

        t.assert.deepStrictEqual(fake.askPassClosed, 1);
    });

    it('Leave an unhandled error of the child as loud as it was', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);

        // Keeping the helper alive must never cost the consumer the crash it
        // would have got with no listener of its own.
        t.assert.throws(() => fake.emitError(new Error('ENOENT')));
        t.assert.deepStrictEqual(fake.askPassClosed, 1);
    });

    it('Tear down the askpass helper when the spawn itself throws', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        // The channel is already listening by then, and no child process will
        // ever come along to close it.
        fake.failOnSpawn(new Error('EACCES'));
        await t.assert.rejects(
            () => spawnSSH.spawn('ls', [ '-lua' ]),
            /EACCES/
        );

        t.assert.deepStrictEqual(fake.askPassOpened, 1);
        t.assert.deepStrictEqual(fake.askPassClosed, 1);
        t.assert.deepStrictEqual(fake.children.length, 0);
    });

    it('Leave the stdin of ssh on its own pipe, with no password', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        await spawnSSH.spawn('cat', []);

        // `-n` would send it to /dev/null, and the writable `stdin` of the
        // child handed back would be a pipe nobody reads.
        t.assert.deepStrictEqual(fake.calls[0]?.args.includes('-n'), false);
    });

    it('Leave the stdin of ssh on its own pipe with a password too', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password'
            },
            fake
        );

        await spawnSSH.spawn('cat', []);

        // Nothing is lost by dropping it here either: the password reaches ssh
        // through the askpass helper, never through a terminal.
        t.assert.deepStrictEqual(fake.calls[0]?.args.includes('-n'), false);
    });

    it('Hand the configured timeout to the deadline', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                timeout: 30000
            },
            fake
        );

        await spawnSSH.spawn('sleep', [ '600' ]);

        t.assert.deepStrictEqual(fake.timeouts, [ 30000 ]);
        t.assert.deepStrictEqual(fake.timeoutAttached, 1);
    });

    it('Arm no deadline when none was asked for', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko'
            },
            fake
        );

        await spawnSSH.spawn('sleep', [ '600' ]);

        // The guard is still built — it is what makes the branch unnecessary —
        // but with nothing to schedule it stays inert.
        t.assert.deepStrictEqual(fake.timeouts, [ undefined ]);
        t.assert.deepStrictEqual(fake.killed, []);
    });

    it('Kill the process and raise a TimeoutError when the deadline is missed', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                timeout: 30000
            },
            fake
        );

        const child = await spawnSSH.spawn('sleep', [ '600' ]);
        const errors: Error[] = [];
        child.on('error', error => errors.push(error));

        fake.expireTimeout();

        t.assert.deepStrictEqual(fake.killed, [ 'SIGTERM' ]);
        t.assert.deepStrictEqual(errors[0]?.name, 'TimeoutError');
    });

    it('Let go of the deadline once the child is gone', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                timeout: 30000
            },
            fake
        );

        await spawnSSH.spawn('ls', [ '-lua' ]);
        fake.emitClose(0);

        // A pending timer would keep the host process alive over a command
        // that already finished.
        t.assert.deepStrictEqual(fake.timeoutDisarmed, 1);
    });

    it('Let go of the deadline even if the consumer wipes every listener', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                timeout: 30000
            },
            fake
        );

        const child = await spawnSSH.spawn('ls', [ '-lua' ]);
        child.removeAllListeners();
        fake.emitClose(0);

        t.assert.deepStrictEqual(fake.timeoutDisarmed, 1);
    });

    it('Tear down the askpass helper when the deadline is missed', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                password: 'not-a-real-password',
                timeout: 30000
            },
            fake
        );

        const child = await spawnSSH.spawn('sleep', [ '600' ]);
        child.on('error', () => {});
        fake.expireTimeout();

        // The timeout is one of the ways a child reaches the end of its life,
        // and the socket holding the credential is owed its teardown all the
        // same.
        t.assert.deepStrictEqual(fake.askPassClosed, 1);
    });

    it('Refuse a timeout that is not a positive number of milliseconds', async (t: it.TestContext) => {
        const fake = new SpawnSSHFake();
        const spawnSSH = new SpawnSSH(
            {
                hostname: 'www.yani-neko.moe',
                username: 'yaniko',
                timeout: -1
            },
            fake
        );

        await t.assert.rejects(() => spawnSSH.spawn('ls', [ '-lua' ]), /Unusable timeout/);

        // Refused before anything was spawned: a deadline that makes no sense
        // must not leave an `ssh` running behind it.
        t.assert.deepStrictEqual(fake.children.length, 0);
    });
});

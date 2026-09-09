import { describe, it } from 'node:test';

import { ControlMasterFake } from './control-master.fake.js';
import { ControlMaster } from './control-master.js';

const OPTIONS = {
    hostname: 'www.yani-neko.moe',
    username: 'yaniko'
};

/** Lets whatever `open` has queued up to the spawn actually run. */
const tick = (): Promise<void> => new Promise<void>(resolve => setImmediate(resolve));

describe('ControlMaster', () => {
    it('Hold the connection open with a process that runs no command', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(OPTIONS, fake);

        await master.open();

        t.assert.deepStrictEqual(fake.calls[0], {
            program: 'ssh',
            args: [
                '-o', 'ControlPath=/tmp/bb-command-ssh-000000/c',
                '-o', 'ControlMaster=yes',
                '-o', 'ControlPersist=no',
                '-o', 'BatchMode=yes',
                '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'ConnectTimeout=10',
                '-N',
                '--',
                'yaniko@www.yani-neko.moe'
            ]
        });
    });

    it('Authenticate the master, and nothing else, with the password', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(
            { ...OPTIONS, password: 'not-a-real-password' },
            fake
        );

        await master.open();

        t.assert.deepStrictEqual(fake.passwords, [ 'not-a-real-password' ]);
        t.assert.ok(fake.calls[0]?.args.includes('BatchMode=no'));
        t.assert.deepStrictEqual(fake.envs[0]?.SSH_ASKPASS, '/tmp/fake/askpass.sh');
    });

    it('Let go of the credential the moment the connection is up', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(
            { ...OPTIONS, password: 'not-a-real-password' },
            fake
        );

        await master.open();

        // Every command from here on rides on the socket, so there is no
        // reason to keep the secret on the heap — nor the helper reachable —
        // for the rest of the session.
        t.assert.deepStrictEqual(fake.askPassClosed, 1);
        t.assert.deepStrictEqual(master.path, fake.path);
    });

    it('Ask the master itself whether the connection is up', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(OPTIONS, fake);

        await master.open();

        // `-O check` talks to the socket: it neither connects nor
        // authenticates, so nothing about credentials belongs in it.
        t.assert.deepStrictEqual(fake.probes[0]?.argv, [
            '-o', 'ControlPath=/tmp/bb-command-ssh-000000/c',
            '-O', 'check',
            '--',
            'yaniko@www.yani-neko.moe'
        ]);
    });

    it('Offer no socket until there is a connection behind it', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        fake.hold();

        const master = new ControlMaster(OPTIONS, fake);
        const opening = master.open();
        await tick();

        // The socket file shows up before the connection can carry anything:
        // handing it out early would be handing out a command that fails.
        t.assert.deepStrictEqual(master.path, null);

        fake.answer();
        await opening;
        t.assert.deepStrictEqual(master.path, fake.path);
    });

    it('Refuse a destination ssh would read as an option', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(
            { ...OPTIONS, username: '-oProxyCommand=touch /tmp/pwn' },
            fake
        );

        await t.assert.rejects(() => master.open(), /username/);

        // Nothing was created and nothing was launched: the check happens
        // before there is anything to clean up after.
        t.assert.deepStrictEqual(fake.creations, 0);
        t.assert.deepStrictEqual(fake.calls, []);
    });

    it('Refuse a deadline that is not a positive number of milliseconds', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster({ ...OPTIONS, connectTimeout: 0 }, fake);

        await t.assert.rejects(() => master.open(), /Unusable timeout/);
        t.assert.deepStrictEqual(fake.creations, 0);
    });

    it('Give the connection twenty seconds to come up by default', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(OPTIONS, fake);

        await master.open();

        // A master that never finishes authenticating never says so, so
        // unlike the timeout of a command this one cannot be left out.
        t.assert.deepStrictEqual(fake.timeouts, [ 20_000 ]);
    });

    it('Explain a refused connection in the words of ssh itself', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        fake.hold();

        const master = new ControlMaster(
            { ...OPTIONS, password: 'not-a-real-password' },
            fake
        );

        const opening = master.open();
        await tick();

        fake.emitStderr('yaniko@www.yani-neko.moe: Permission denied (password).\n');
        fake.emitExit(255);
        fake.poll();

        await t.assert.rejects(() => opening, /Permission denied \(password\)/);
        t.assert.deepStrictEqual(master.path, null);
    });

    it('Say which way the master died when it said nothing', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        fake.hold();

        const master = new ControlMaster(OPTIONS, fake);
        const opening = master.open();
        await tick();

        fake.emitExit(null, 'SIGKILL');
        fake.poll();

        await t.assert.rejects(() => opening, /was killed with SIGKILL/);
    });

    it('Never leave a master behind when the wait ends any other way', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(OPTIONS, {
            timeoutGuard: timeout => fake.timeoutGuard(timeout),
            lastResort:   fake.lastResort,
            socket:       fake.socket,
            askPass:      () => fake.askPass(),
            rmSync:       path => fake.rmSync(path),
            spawn:        (program, args, options) => fake.spawn(program, args, options),
            ready:        () => ({
                wait: async () => { throw new Error('the wait itself broke'); }
            })
        });

        await t.assert.rejects(() => master.open(), /the wait itself broke/);

        // An authenticated connection with nobody left to close it is the one
        // thing that must not survive a failed open.
        t.assert.deepStrictEqual(fake.killed, [ 'SIGTERM' ]);
    });

    it('Kill the master when it takes too long to come up', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        fake.hold();

        const master = new ControlMaster({ ...OPTIONS, connectTimeout: 5000 }, fake);
        const opening = master.open();
        await tick();

        fake.expireTimeout();
        fake.poll();

        // The wording is the connection's own: there was no command yet to
        // blame for the wait.
        await t.assert.rejects(() => opening, /connection could not be opened within 5000 ms/);
        t.assert.ok(fake.killed.includes('SIGTERM'));
    });

    it('Hand back everything the master owed once it is gone', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(
            { ...OPTIONS, password: 'not-a-real-password' },
            fake
        );

        await master.open();

        // The socket stops being on offer the instant the master dies; giving
        // the directory and the helper back is owed, not instantaneous.
        fake.emitExit(0);
        t.assert.deepStrictEqual(master.path, null);
        await tick();

        t.assert.deepStrictEqual(fake.released, [ '/tmp/bb-command-ssh-000000' ]);
        t.assert.deepStrictEqual(fake.removals, 1);
        t.assert.ok(fake.askPassClosed >= 1);
    });

    it('Let go of the connection even if the consumer wipes every listener', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(OPTIONS, fake);

        await master.open();
        fake.children[0]?.removeAllListeners();
        fake.emitExit(0);
        await tick();

        // The teardown deliberately stays out of the listener registry.
        t.assert.deepStrictEqual(master.path, null);
        t.assert.deepStrictEqual(fake.removals, 1);
    });

    it('Kill the master and wipe its directory if the host process dies first', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(OPTIONS, fake);

        await master.open();
        fake.lastResortOf('/tmp/bb-command-ssh-000000');

        // Nothing kills a child just because its parent died, and an orphaned
        // master is an authenticated session nobody owns any more.
        t.assert.deepStrictEqual(fake.killed, [ 'SIGTERM' ]);
        t.assert.deepStrictEqual(fake.wiped, [ '/tmp/bb-command-ssh-000000' ]);
    });

    it('End the connection on close, and wait until it is really gone', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(OPTIONS, fake);

        await master.open();

        let closed = false;
        const closing = master.close().then(() => { closed = true; });
        await tick();

        // `ssh` handles SIGTERM, and on its way out it tears the connection
        // down instead of leaving the remote end to notice on its own.
        t.assert.deepStrictEqual(fake.killed, [ 'SIGTERM' ]);
        t.assert.deepStrictEqual(closed, false);

        fake.emitExit(0);
        await closing;
        t.assert.deepStrictEqual(master.path, null);
    });

    it('Tolerate a close of something that was never opened', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(OPTIONS, fake);

        await master.close();

        t.assert.deepStrictEqual(fake.killed, []);
    });

    it('Open a single connection however many times it is asked', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(OPTIONS, fake);

        await master.open();
        await master.open();

        t.assert.deepStrictEqual(fake.calls.length, 1);
        t.assert.deepStrictEqual(fake.creations, 1);
    });

    it('Give two callers opening at once the same connection', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        fake.hold();

        const master = new ControlMaster(OPTIONS, fake);
        const first  = master.open();
        const second = master.open();
        await tick();

        fake.answer();
        await Promise.all([ first, second ]);

        // A second master would authenticate again for nothing, and leave a
        // socket nobody remembers to close.
        t.assert.deepStrictEqual(fake.calls.length, 1);
        t.assert.deepStrictEqual(fake.creations, 1);
    });

    it('Leave nothing behind when the credential provider fails', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        fake.failOnOpen(new Error('EADDRINUSE'));

        const master = new ControlMaster(
            { ...OPTIONS, password: 'not-a-real-password' },
            fake
        );

        await t.assert.rejects(() => master.open(), /EADDRINUSE/);

        // No master is coming to trigger the ordinary teardown, so the
        // directory and the helper are owed right here.
        t.assert.deepStrictEqual(fake.removals, 1);
        t.assert.deepStrictEqual(fake.askPassClosed, 1);
        t.assert.deepStrictEqual(fake.protected, []);
    });

    it('Leave nothing behind when the master cannot even be launched', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        fake.failOnSpawn(new Error('spawn ssh ENOENT'));

        const master = new ControlMaster(OPTIONS, fake);

        await t.assert.rejects(() => master.open(), /ENOENT/);

        t.assert.deepStrictEqual(fake.removals, 1);
        t.assert.deepStrictEqual(fake.protected, []);
    });

    it('Open again after the connection was closed', async (t: it.TestContext) => {
        const fake = new ControlMasterFake();
        const master = new ControlMaster(OPTIONS, fake);

        await master.open();
        const closing = master.close();
        await tick();
        fake.emitExit(0);
        await closing;

        await master.open();

        // The reason the old one died is not the reason to refuse a new one.
        t.assert.deepStrictEqual(fake.calls.length, 2);
        t.assert.deepStrictEqual(master.path, fake.path);
    });
});

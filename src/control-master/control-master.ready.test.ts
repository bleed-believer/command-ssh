import { describe, it } from 'node:test';

import { ControlMasterReadyFake } from './control-master.ready.fake.js';
import { ControlMasterReady } from './control-master.ready.js';

const ARGV = [ '-o', 'ControlPath=/tmp/bb-command-ssh-000000/c', '-O', 'check', '--', 'yaniko@www.yani-neko.moe' ];

describe('ControlMasterReady', () => {
    it('Ask the master itself whether it is up', async (t: it.TestContext) => {
        const fake = new ControlMasterReadyFake(0);
        const ready = new ControlMasterReady(ARGV, { PATH: '/usr/bin' }, fake);

        await ready.wait(() => null);

        t.assert.deepStrictEqual(fake.probes, [ [ 'ssh', ...ARGV ] ]);
        t.assert.deepStrictEqual(fake.envs[0], { PATH: '/usr/bin' });
    });

    it('Stop probing the moment the master answers', async (t: it.TestContext) => {
        const fake = new ControlMasterReadyFake(255, 255, 0);
        const ready = new ControlMasterReady(ARGV, {}, fake);

        await ready.wait(() => null);

        t.assert.deepStrictEqual(fake.probes.length, 3);
    });

    it('Back off between probes instead of hammering the socket', async (t: it.TestContext) => {
        const fake = new ControlMasterReadyFake(255, 255, 255, 0);
        const ready = new ControlMasterReady(ARGV, {}, fake);

        await ready.wait(() => null);

        // Tight at first, so a host on the same network is not made to wait
        // for a round number.
        t.assert.deepStrictEqual(fake.delays, [ 25, 50, 100 ]);
    });

    it('Stop growing the delay once it is long enough', async (t: it.TestContext) => {
        const fake = new ControlMasterReadyFake();
        const ready = new ControlMasterReady(ARGV, {}, fake);

        // Nothing is ever going to answer, and the deadline is what ends it.
        await t.assert.rejects(
            () => ready.wait(
                () => fake.probes.length >= 10
                    ? new Error('The connection timed out.')
                    : null
            ),
            /timed out/
        );

        t.assert.deepStrictEqual(
            fake.delays,
            [ 25, 50, 100, 200, 400, 800, 800, 800, 800 ]
        );
    });

    it('Give up the moment the master is gone', async (t: it.TestContext) => {
        const fake = new ControlMasterReadyFake();
        const ready = new ControlMasterReady(ARGV, {}, fake);

        // A refused password kills the master, and no amount of probing is
        // going to make a dead one answer.
        await t.assert.rejects(
            () => ready.wait(() => new Error('Permission denied, please try again.')),
            /Permission denied/
        );

        t.assert.deepStrictEqual(fake.probes, []);
    });

    it('Never wait out a delay for a master that died mid-probe', async (t: it.TestContext) => {
        const fake = new ControlMasterReadyFake(255);
        const ready = new ControlMasterReady(ARGV, {}, fake);

        let dead: Error | null = null;
        const wait = ready.wait(() => dead);

        // It died while the probe was in flight: the caller hears about it
        // now, not one backoff from now.
        dead = new Error('The connection timed out.');
        await t.assert.rejects(() => wait, /timed out/);

        t.assert.deepStrictEqual(fake.delays, []);
    });

    it('Read a probe that could not even be launched as a not-yet', async (t: it.TestContext) => {
        const fake = new ControlMasterReadyFake('throw', 'error', 0);
        const ready = new ControlMasterReady(ARGV, {}, fake);

        // Neither says anything about the master: what does is the deadline.
        await ready.wait(() => null);

        t.assert.deepStrictEqual(fake.probes.length, 3);
    });
});

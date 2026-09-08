import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';

import { TeardownGuard } from './spawn-ssh.teardown-guard.js';

/**
 * The guard only ever touches `emit`, so a bare emitter is the whole surface
 * it needs: no process, no streams, nothing to clean up afterwards.
 */
function childOf(): ChildProcessWithoutNullStreams {
    return new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
}

describe('TeardownGuard', () => {
    it('Run the teardown once the child closes', async (t: it.TestContext) => {
        const child = childOf();
        let runs = 0;

        new TeardownGuard(child, async () => { runs++; }).attach();
        child.emit('close', 0);

        t.assert.deepStrictEqual(runs, 1);
    });

    it('Run the teardown when the child exits', async (t: it.TestContext) => {
        const child = childOf();
        let runs = 0;

        new TeardownGuard(child, async () => { runs++; }).attach();
        child.emit('exit', 0, null);

        t.assert.deepStrictEqual(runs, 1);
    });

    it('Run the teardown when the child never got to live', async (t: it.TestContext) => {
        const child = childOf();
        let runs = 0;

        new TeardownGuard(child, async () => { runs++; }).attach();
        child.on('error', () => {});
        child.emit('error', new Error('ENOENT'));

        t.assert.deepStrictEqual(runs, 1);
    });

    it('Run the teardown exactly once across the whole lifecycle', async (t: it.TestContext) => {
        const child = childOf();
        let runs = 0;

        new TeardownGuard(child, async () => { runs++; }).attach();

        // The real order of a child process that dies on its own.
        child.emit('exit', 0, null);
        child.emit('close', 0);

        t.assert.deepStrictEqual(runs, 1);
    });

    it('Survive a consumer wiping every listener of the child', async (t: it.TestContext) => {
        const child = childOf();
        let runs = 0;

        new TeardownGuard(child, async () => { runs++; }).attach();
        child.on('close', () => {});
        child.removeAllListeners();
        child.emit('close', 0);

        t.assert.deepStrictEqual(runs, 1);
    });

    it('Survive a consumer wiping the listeners of one lifecycle event', async (t: it.TestContext) => {
        const child = childOf();
        let runs = 0;

        new TeardownGuard(child, async () => { runs++; }).attach();
        child.removeAllListeners('close');
        child.emit('close', 0);

        t.assert.deepStrictEqual(runs, 1);
    });

    it('Never enter the listener registry of the child', async (t: it.TestContext) => {
        const child = childOf();

        new TeardownGuard(child, async () => {}).attach();

        t.assert.deepStrictEqual(child.eventNames(), []);
        t.assert.deepStrictEqual(child.listenerCount('close'), 0);
        t.assert.deepStrictEqual(child.listenerCount('exit'),  0);
        t.assert.deepStrictEqual(child.listenerCount('error'), 0);
    });

    it('Leave an unhandled error as loud as it was', async (t: it.TestContext) => {
        const child = childOf();
        let runs = 0;

        // With no listener of its own, the guard must not become the one that
        // silently absorbs the error on the consumer's behalf.
        new TeardownGuard(child, async () => { runs++; }).attach();

        t.assert.throws(() => child.emit('error', new Error('ENOENT')));
        t.assert.deepStrictEqual(runs, 1);
    });

    it('Deliver every event to the consumer untouched', async (t: it.TestContext) => {
        const child = childOf();
        const seen: unknown[][] = [];

        new TeardownGuard(child, async () => {}).attach();
        child.on('close', (...args) => seen.push(args));
        child.on('data', (...args) => seen.push(args));

        t.assert.deepStrictEqual(child.emit('data', 'chunk'), true);
        t.assert.deepStrictEqual(child.emit('close', 255, null), true);

        // And the return value of an event nobody listens to is still `false`.
        t.assert.deepStrictEqual(child.emit('spawn'), false);
        t.assert.deepStrictEqual(seen, [ [ 'chunk' ], [ 255, null ] ]);
    });

    it('Never leave the child with a new enumerable property', async (t: it.TestContext) => {
        const child = childOf();
        const before = Object.keys(child);

        new TeardownGuard(child, async () => {}).attach();

        t.assert.deepStrictEqual(Object.keys(child), before);
    });

    it('Swallow a failing teardown instead of crashing the host', async (t: it.TestContext) => {
        const child = childOf();
        let runs = 0;

        new TeardownGuard(child, async () => {
            runs++;
            throw new Error('rm failed');
        }).attach();

        child.emit('close', 0);

        // An escaped rejection fails this test by itself: the runner reports
        // it against whichever test is on the clock.
        await new Promise(resolve => setTimeout(resolve, 10));
        t.assert.deepStrictEqual(runs, 1);
    });
});

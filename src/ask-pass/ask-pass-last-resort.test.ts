import { describe, it } from 'node:test';

import { AskPassLastResortFake } from './ask-pass-last-resort.fake.js';
import { AskPassLastResort } from './ask-pass-last-resort.js';

describe('AskPassLastResort', () => {
    it('Wipe a protected directory when the process exits', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        lastResort.protect('/tmp/bb-command-ssh-000000');
        fake.emit('exit');

        t.assert.deepStrictEqual(fake.removed, [ '/tmp/bb-command-ssh-000000' ]);
    });

    it('Wipe every protected directory at once', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        lastResort.protect('/tmp/a');
        lastResort.protect('/tmp/b');
        fake.emit('exit');

        t.assert.deepStrictEqual(fake.removed, [ '/tmp/a', '/tmp/b' ]);
    });

    it('Leave alone what the ordinary teardown already removed', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        lastResort.protect('/tmp/a');
        lastResort.protect('/tmp/b');
        lastResort.release('/tmp/a');
        fake.emit('exit');

        t.assert.deepStrictEqual(fake.removed, [ '/tmp/b' ]);
    });

    it('Give the rest their turn when one removal fails', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        // Crashing on the way out would turn a leaked file into a crash.
        fake.failOnRemove(new Error('EBUSY'));
        lastResort.protect('/tmp/a');
        lastResort.protect('/tmp/b');
        fake.emit('exit');

        t.assert.deepStrictEqual(fake.removed, [ '/tmp/a', '/tmp/b' ]);
    });

    it('Wipe the directories on a signal too', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        // A signal never reaches `exit` on its own, and Ctrl+C is how a CLI
        // usually dies.
        lastResort.protect('/tmp/a');
        fake.emit('SIGINT');

        t.assert.deepStrictEqual(fake.removed, [ '/tmp/a' ]);
    });

    it('Watch every signal that ends a process', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        lastResort.protect('/tmp/a');

        t.assert.deepStrictEqual(
            [ ...fake.events ].sort(),
            [ 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'exit' ].sort()
        );
    });

    it('Re-raise the signal the process was going to die from', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        lastResort.protect('/tmp/a');
        fake.emit('SIGTERM');

        // Nobody else was listening, so the default disposition has to be put
        // back instead of picking an exit code that was never ours to pick.
        t.assert.deepStrictEqual(fake.killed, [ 'SIGTERM' ]);
        t.assert.deepStrictEqual(fake.events, []);
    });

    it('Never end a process the host is still deciding about', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        // The consumer has its own SIGINT handler: it owns what happens next.
        fake.addForeign('SIGINT');
        lastResort.protect('/tmp/a');
        fake.emit('SIGINT');

        t.assert.deepStrictEqual(fake.removed, [ '/tmp/a' ]);
        t.assert.deepStrictEqual(fake.killed, []);
    });

    it('Never touch the host process while nothing is at risk', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        t.assert.deepStrictEqual(fake.events, []);

        lastResort.protect('/tmp/a');
        t.assert.deepStrictEqual(fake.events.length, 5);

        // With the last directory gone, so is every trace of this class.
        lastResort.release('/tmp/a');
        t.assert.deepStrictEqual(fake.events, []);
    });

    it('Keep watching while any other directory is still at risk', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        lastResort.protect('/tmp/a');
        lastResort.protect('/tmp/b');
        lastResort.release('/tmp/a');

        t.assert.deepStrictEqual(fake.events.length, 5);
    });

    it('Register the listeners only once, however many are protected', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        for (let i = 0; i < 20; i++) {
            lastResort.protect(`/tmp/${i}`);
        }

        // Twenty concurrent executions must not cost the consumer a
        // `MaxListenersExceeded` warning.
        t.assert.deepStrictEqual(fake.listenerCount('exit'), 1);
        t.assert.deepStrictEqual(fake.listenerCount('SIGINT'), 1);
    });

    it('Ignore a release of something that was never protected', async (t: it.TestContext) => {
        const fake = new AskPassLastResortFake();
        const lastResort = new AskPassLastResort(fake);

        lastResort.protect('/tmp/a');
        lastResort.release('/tmp/nowhere');
        fake.emit('exit');

        t.assert.deepStrictEqual(fake.removed, [ '/tmp/a' ]);
    });

    it('Share a single registry across the whole process', async (t: it.TestContext) => {
        t.assert.deepStrictEqual(AskPassLastResort.shared, AskPassLastResort.shared);
    });
});

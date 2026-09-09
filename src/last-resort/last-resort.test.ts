import { describe, it } from 'node:test';

import { LastResortFake } from './last-resort.fake.js';
import { LastResort } from './last-resort.js';

describe('LastResort', () => {
    it('Run the cleanup of a protected directory when the process exits', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);
        const ran: string[] = [];

        lastResort.protect('/tmp/bb-command-ssh-000000', () => ran.push('/tmp/bb-command-ssh-000000'));
        fake.emit('exit');

        t.assert.deepStrictEqual(ran, [ '/tmp/bb-command-ssh-000000' ]);
    });

    it('Run every protected cleanup at once', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);
        const ran: string[] = [];

        lastResort.protect('/tmp/a', () => ran.push('/tmp/a'));
        lastResort.protect('/tmp/b', () => ran.push('/tmp/b'));
        fake.emit('exit');

        t.assert.deepStrictEqual(ran, [ '/tmp/a', '/tmp/b' ]);
    });

    it('Leave alone what the ordinary teardown already dealt with', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);
        const ran: string[] = [];

        lastResort.protect('/tmp/a', () => ran.push('/tmp/a'));
        lastResort.protect('/tmp/b', () => ran.push('/tmp/b'));
        lastResort.release('/tmp/a');
        fake.emit('exit');

        t.assert.deepStrictEqual(ran, [ '/tmp/b' ]);
    });

    it('Replace the cleanup of a directory that is protected again', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);
        const ran: string[] = [];

        // The identity is the directory, so the same one never ends up with
        // two cleanups fighting over it.
        lastResort.protect('/tmp/a', () => ran.push('first'));
        lastResort.protect('/tmp/a', () => ran.push('second'));
        fake.emit('exit');

        t.assert.deepStrictEqual(ran, [ 'second' ]);
    });

    it('Give the rest their turn when one cleanup throws', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);
        const ran: string[] = [];

        // Crashing on the way out would turn a leaked file into a crash.
        lastResort.protect('/tmp/a', () => { throw new Error('EBUSY'); });
        lastResort.protect('/tmp/b', () => ran.push('/tmp/b'));
        fake.emit('exit');

        t.assert.deepStrictEqual(ran, [ '/tmp/b' ]);
    });

    it('Run every cleanup only once, however many ways the process ends', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);
        const ran: string[] = [];

        // A host handler that exits on SIGINT fires `exit` right after, and a
        // second kill of the same process is not a no-op.
        fake.addForeign('SIGINT');
        lastResort.protect('/tmp/a', () => ran.push('/tmp/a'));
        fake.emit('SIGINT');
        fake.emit('exit');

        t.assert.deepStrictEqual(ran, [ '/tmp/a' ]);
    });

    it('Run the cleanups on a signal too', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);
        const ran: string[] = [];

        // A signal never reaches `exit` on its own, and Ctrl+C is how a CLI
        // usually dies.
        lastResort.protect('/tmp/a', () => ran.push('/tmp/a'));
        fake.emit('SIGINT');

        t.assert.deepStrictEqual(ran, [ '/tmp/a' ]);
    });

    it('Watch every signal that ends a process', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);

        lastResort.protect('/tmp/a', () => {});

        t.assert.deepStrictEqual(
            [ ...fake.events ].sort(),
            [ 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'exit' ].sort()
        );
    });

    it('Re-raise the signal the process was going to die from', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);

        lastResort.protect('/tmp/a', () => {});
        fake.emit('SIGTERM');

        // Nobody else was listening, so the default disposition has to be put
        // back instead of picking an exit code that was never ours to pick.
        t.assert.deepStrictEqual(fake.killed, [ 'SIGTERM' ]);
        t.assert.deepStrictEqual(fake.events, []);
    });

    it('Never end a process the host is still deciding about', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);
        const ran: string[] = [];

        // The consumer has its own SIGINT handler: it owns what happens next.
        fake.addForeign('SIGINT');
        lastResort.protect('/tmp/a', () => ran.push('/tmp/a'));
        fake.emit('SIGINT');

        t.assert.deepStrictEqual(ran, [ '/tmp/a' ]);
        t.assert.deepStrictEqual(fake.killed, []);
    });

    it('Never touch the host process while nothing is at risk', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);

        t.assert.deepStrictEqual(fake.events, []);

        lastResort.protect('/tmp/a', () => {});
        t.assert.deepStrictEqual(fake.events.length, 5);

        // With the last directory gone, so is every trace of this class.
        lastResort.release('/tmp/a');
        t.assert.deepStrictEqual(fake.events, []);
    });

    it('Keep watching while any other directory is still at risk', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);

        lastResort.protect('/tmp/a', () => {});
        lastResort.protect('/tmp/b', () => {});
        lastResort.release('/tmp/a');

        t.assert.deepStrictEqual(fake.events.length, 5);
    });

    it('Register the listeners only once, however many are protected', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);

        for (let i = 0; i < 20; i++) {
            lastResort.protect(`/tmp/${i}`, () => {});
        }

        // Twenty concurrent executions must not cost the consumer a
        // `MaxListenersExceeded` warning.
        t.assert.deepStrictEqual(fake.listenerCount('exit'), 1);
        t.assert.deepStrictEqual(fake.listenerCount('SIGINT'), 1);
    });

    it('Ignore a release of something that was never protected', async (t: it.TestContext) => {
        const fake = new LastResortFake();
        const lastResort = new LastResort(fake);
        const ran: string[] = [];

        lastResort.protect('/tmp/a', () => ran.push('/tmp/a'));
        lastResort.release('/tmp/nowhere');
        fake.emit('exit');

        t.assert.deepStrictEqual(ran, [ '/tmp/a' ]);
    });

    it('Share a single registry across the whole process', async (t: it.TestContext) => {
        t.assert.deepStrictEqual(LastResort.shared, LastResort.shared);
    });
});

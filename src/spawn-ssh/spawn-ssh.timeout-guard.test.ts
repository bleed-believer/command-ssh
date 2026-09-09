import { describe, it } from 'node:test';

import { SpawnSSHTimeoutGuardFake } from './spawn-ssh.timeout-guard.fake.js';
import { SpawnSSHTimeoutGuard } from './spawn-ssh.timeout-guard.js';

describe('SpawnSSHTimeoutGuard', () => {
    it('Schedule the expiry for the requested number of milliseconds', (t: it.TestContext) => {
        const fake = new SpawnSSHTimeoutGuardFake();
        const guard = new SpawnSSHTimeoutGuard(1500, fake);

        guard.attach(fake.createChild());

        t.assert.deepStrictEqual(fake.scheduled.map(x => x.ms), [ 1500 ]);
    });

    it('Stay inert when no timeout was configured', (t: it.TestContext) => {
        const fake = new SpawnSSHTimeoutGuardFake();
        const guard = new SpawnSSHTimeoutGuard(undefined, fake);

        guard.attach(fake.createChild());

        // Nothing scheduled means nothing to leak, and nothing keeping the
        // host process alive over a command that already finished.
        t.assert.deepStrictEqual(fake.scheduled.length, 0);
    });

    it('Kill the process when the deadline is missed', (t: it.TestContext) => {
        const fake = new SpawnSSHTimeoutGuardFake();
        const guard = new SpawnSSHTimeoutGuard(1500, fake);
        const child = fake.createChild();

        guard.attach(child);
        child.on('error', () => {});
        fake.expire();

        t.assert.deepStrictEqual(fake.signals, [ 'SIGTERM' ]);
    });

    it('Raise a recognizable error on the process it killed', (t: it.TestContext) => {
        const fake = new SpawnSSHTimeoutGuardFake();
        const guard = new SpawnSSHTimeoutGuard(1500, fake);
        const child = fake.createChild();

        const errors: Error[] = [];
        guard.attach(child);
        child.on('error', error => errors.push(error));
        fake.expire();

        // The kill on its own would reach the caller as an ordinary `close`
        // with a null code, indistinguishable from a command that simply died.
        t.assert.deepStrictEqual(errors.length, 1);
        t.assert.deepStrictEqual(errors[0]?.name, 'TimeoutError');
        t.assert.match(errors[0]?.message ?? '', /timed out after 1500 ms/);
    });

    it('Call off the expiry once disarmed', (t: it.TestContext) => {
        const fake = new SpawnSSHTimeoutGuardFake();
        const guard = new SpawnSSHTimeoutGuard(1500, fake);

        guard.attach(fake.createChild());
        guard.disarm();

        t.assert.deepStrictEqual(fake.cancelled, 1);
    });

    it('Disarm only once, however many times it is asked', (t: it.TestContext) => {
        const fake = new SpawnSSHTimeoutGuardFake();
        const guard = new SpawnSSHTimeoutGuard(1500, fake);

        guard.attach(fake.createChild());
        guard.disarm();
        guard.disarm();
        guard.disarm();

        // A child reaches the end of its life through `exit`, `close` and
        // `error` alike, and any of them may be the one that disarms.
        t.assert.deepStrictEqual(fake.cancelled, 1);
    });

    it('Tolerate a disarm with nothing ever attached', (t: it.TestContext) => {
        const fake = new SpawnSSHTimeoutGuardFake();
        const guard = new SpawnSSHTimeoutGuard(1500, fake);

        t.assert.doesNotThrow(() => guard.disarm());
        t.assert.deepStrictEqual(fake.cancelled, 0);
    });

    it('Refuse a timeout that is not a positive number of milliseconds', (t: it.TestContext) => {
        const fake = new SpawnSSHTimeoutGuardFake();

        // Zero and the negatives would fire at once, and the non-finite ones
        // never. Both are typos worth failing over, before anything is spawned.
        t.assert.throws(() => new SpawnSSHTimeoutGuard(0, fake), /Unusable timeout/);
        t.assert.throws(() => new SpawnSSHTimeoutGuard(-1, fake), /Unusable timeout/);
        t.assert.throws(() => new SpawnSSHTimeoutGuard(NaN, fake), /Unusable timeout/);
        t.assert.throws(() => new SpawnSSHTimeoutGuard(Infinity, fake), /Unusable timeout/);
    });
});

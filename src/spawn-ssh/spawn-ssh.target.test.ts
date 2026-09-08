import { describe, it } from 'node:test';

import { SpawnSSHTarget } from './spawn-ssh.target.js';

describe('SpawnSSHTarget', () => {
    it('Join the username and the hostname into a destination', (t: it.TestContext) => {
        const target = new SpawnSSHTarget('yaniko', 'www.yani-neko.moe');
        t.assert.deepStrictEqual(target.value(), 'yaniko@www.yani-neko.moe');
    });

    it('Keep the dashes a real hostname is made of', (t: it.TestContext) => {
        const target = new SpawnSSHTarget('deploy-bot', 'srv-01.yani-neko.moe');
        t.assert.deepStrictEqual(target.value(), 'deploy-bot@srv-01.yani-neko.moe');
    });

    it('Accept an IPv4 literal as a hostname', (t: it.TestContext) => {
        // 203.0.113.0/24 is reserved for documentation (RFC 5737), so this
        // stays a literal and never becomes somebody's address.
        const target = new SpawnSSHTarget('yaniko', '203.0.113.7');
        t.assert.deepStrictEqual(target.value(), 'yaniko@203.0.113.7');
    });

    it('Accept a username carrying a tenant, which ssh splits on the last @', (t: it.TestContext) => {
        const target = new SpawnSSHTarget('yaniko@tenant', 'www.yani-neko.moe');
        t.assert.deepStrictEqual(target.value(), 'yaniko@tenant@www.yani-neko.moe');
    });

    it('Refuse a username that ssh would read as an option', (t: it.TestContext) => {
        // The whole point: this used to become the argv element
        // `-oProxyCommand=touch /tmp/pwn@h`, which ssh obeys.
        const target = new SpawnSSHTarget('-oProxyCommand=touch /tmp/pwn', 'h');
        t.assert.throws(() => target.value(), /username/);
    });

    it('Refuse a hostname that ssh would read as an option', (t: it.TestContext) => {
        const target = new SpawnSSHTarget('yaniko', '-oProxyCommand=id');
        t.assert.throws(() => target.value(), /hostname/);
    });

    it('Refuse whitespace anywhere in the destination', (t: it.TestContext) => {
        t.assert.throws(
            () => new SpawnSSHTarget('yani ko', 'www.yani-neko.moe').value(),
            /username/
        );

        t.assert.throws(
            () => new SpawnSSHTarget('yaniko', 'www.yani-neko.moe -oProxyCommand=id').value(),
            /hostname/
        );
    });

    it('Refuse control characters trying to break the destination apart', (t: it.TestContext) => {
        t.assert.throws(
            () => new SpawnSSHTarget('yaniko', 'host\u0001evil').value(),
            /hostname/
        );
    });

    it('Refuse an empty username or hostname', (t: it.TestContext) => {
        t.assert.throws(() => new SpawnSSHTarget('', 'h').value(), /username/);
        t.assert.throws(() => new SpawnSSHTarget('u', '').value(), /hostname/);
    });

    it('Refuse a hostname that would move the username boundary', (t: it.TestContext) => {
        // `u@evil@real` makes ssh take `u@evil` as the username.
        t.assert.throws(
            () => new SpawnSSHTarget('yaniko', 'evil@www.yani-neko.moe').value(),
            /hostname/
        );

        t.assert.throws(
            () => new SpawnSSHTarget('yaniko', 'host/path').value(),
            /hostname/
        );
    });
});

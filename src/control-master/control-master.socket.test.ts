import { describe, it } from 'node:test';

import { ControlMasterSocketFake } from './control-master.socket.fake.js';
import { ControlMasterSocket } from './control-master.socket.js';

describe('ControlMasterSocket', () => {
    it('Put the socket inside a private temporary directory', async (t: it.TestContext) => {
        const fake = new ControlMasterSocketFake();
        const socket = new ControlMasterSocket(fake);

        const paths = await socket.create();

        t.assert.deepStrictEqual(fake.prefixes, [ '/tmp/bb-command-ssh-' ]);
        t.assert.match(paths.directory, /^\/tmp\/bb-command-ssh-\d+$/);
        t.assert.deepStrictEqual(paths.path, `${paths.directory}/c`);
    });

    it('Keep the path of the socket short', async (t: it.TestContext) => {
        const fake = new ControlMasterSocketFake('/tmp');
        const socket = new ControlMasterSocket(fake);

        const paths = await socket.create();

        // `ssh` binds this as a UNIX socket, and the whole path cannot go
        // beyond ~108 bytes.
        t.assert.ok(paths.path.length < 108);
        t.assert.deepStrictEqual(paths.path.slice(paths.directory.length), '/c');
    });

    it('Never hand two connections the same directory', async (t: it.TestContext) => {
        const fake = new ControlMasterSocketFake();

        const first  = await new ControlMasterSocket(fake).create();
        const second = await new ControlMasterSocket(fake).create();

        t.assert.notDeepStrictEqual(first.directory, second.directory);
    });

    it('Remove the whole directory, not only the socket', async (t: it.TestContext) => {
        const fake = new ControlMasterSocketFake();
        const socket = new ControlMasterSocket(fake);

        const paths = await socket.create();
        await socket.remove();

        t.assert.deepStrictEqual(fake.removed, [ paths.directory ]);
    });

    it('Ignore a remove without a previous create', async (t: it.TestContext) => {
        const fake = new ControlMasterSocketFake();
        const socket = new ControlMasterSocket(fake);

        await socket.remove();

        t.assert.deepStrictEqual(fake.removed, []);
    });

    it('Remove the directory only once', async (t: it.TestContext) => {
        const fake = new ControlMasterSocketFake();
        const socket = new ControlMasterSocket(fake);

        await socket.create();
        await socket.remove();
        await socket.remove();

        t.assert.deepStrictEqual(fake.removed.length, 1);
    });
});

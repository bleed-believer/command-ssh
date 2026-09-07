import { describe, it } from 'node:test';

import { AskPassScriptFake } from './ask-pass-script.fake.js';
import { AskPassScript } from './ask-pass-script.js';

describe('AskPassScript', () => {
    it('Create the helper inside a private temporary directory', async (t: it.TestContext) => {
        const fake = new AskPassScriptFake('/tmp');
        const script = new AskPassScript(fake);

        const paths = await script.create();

        t.assert.deepStrictEqual(fake.prefixes, [ '/tmp/bb-command-ssh-' ]);
        t.assert.match(paths.command, /^\/tmp\/bb-command-ssh-\d+\/askpass\.sh$/);
        t.assert.match(paths.socket,  /^\/tmp\/bb-command-ssh-\d+\/s$/);
    });

    it('Never write the password: the helper only knows the socket', async (t: it.TestContext) => {
        const fake = new AskPassScriptFake();
        const script = new AskPassScript(fake);

        const paths = await script.create();

        for (const [ , file ] of fake.files) {
            t.assert.doesNotMatch(file.data, /not-a-real-password/);
        }

        const client = [ ...fake.files ].find(([ path ]) => path.endsWith('.mjs'));
        t.assert.ok(client);
        t.assert.match(client[1].data, new RegExp(JSON.stringify(paths.socket)));
    });

    it('Restrict the helper permissions to the owner', async (t: it.TestContext) => {
        const fake = new AskPassScriptFake();
        const script = new AskPassScript(fake);

        const paths = await script.create();

        t.assert.deepStrictEqual(fake.files.get(paths.command)?.mode, 0o700);
        t.assert.deepStrictEqual(
            [ ...fake.files ].find(([ path ]) => path.endsWith('.mjs'))?.[1].mode,
            0o600
        );
    });

    it('Point the executable to the current node binary', async (t: it.TestContext) => {
        const fake = new AskPassScriptFake();
        const script = new AskPassScript(fake);

        const paths = await script.create();
        const command = fake.files.get(paths.command)?.data ?? '';

        t.assert.match(command, /^#!\/bin\/sh\n/);
        t.assert.ok(command.includes(`'${process.execPath}'`));
    });

    it('Escape single quotes coming from the temporary directory', async (t: it.TestContext) => {
        const fake = new AskPassScriptFake(`/tmp/ya'niko`);
        const script = new AskPassScript(fake);

        const paths = await script.create();
        const command = fake.files.get(paths.command)?.data ?? '';

        t.assert.ok(command.includes(`'\\''`));
    });

    it('Remove the whole directory, not only the files', async (t: it.TestContext) => {
        const fake = new AskPassScriptFake();
        const script = new AskPassScript(fake);

        const paths = await script.create();
        await script.remove();

        t.assert.deepStrictEqual(fake.removed.length, 1);
        t.assert.ok(paths.command.startsWith(`${fake.removed[0]}/`));
        t.assert.deepStrictEqual(fake.files.size, 0);
    });

    it('Ignore a remove without a previous create', async (t: it.TestContext) => {
        const fake = new AskPassScriptFake();
        const script = new AskPassScript(fake);

        await script.remove();

        t.assert.deepStrictEqual(fake.removed, []);
    });

    it('Remove the directory only once', async (t: it.TestContext) => {
        const fake = new AskPassScriptFake();
        const script = new AskPassScript(fake);

        await script.create();
        await script.remove();
        await script.remove();

        t.assert.deepStrictEqual(fake.removed.length, 1);
    });
});

import { ExecuteSSHFake } from './execute-ssh.fake.js';
import { describe, it } from 'node:test';
import { ExecuteSSH } from './execute-ssh.js';

describe('ExecuteSSH', () => {
    it('Forward options to createSpawnSSH and spawn with correct arguments', async (t: it.TestContext) => {
        const fake = new ExecuteSSHFake();
        const options = {
            hostname: 'localhost',
            username: 'test-user',
            port: 2222
        };
        const executor = new ExecuteSSH(options, fake);

        const execPromise = executor.execute('ls', '-la', '/tmp');

        // Allow microtasks to execute so that spawn is called
        await new Promise(resolve => setImmediate(resolve));

        t.assert.deepStrictEqual(fake.options.length, 1);
        t.assert.deepStrictEqual(fake.options[0], options);

        t.assert.deepStrictEqual(fake.calls.length, 1);
        t.assert.deepStrictEqual(fake.calls[0], {
            program: 'ls',
            args: [ '-la', '/tmp' ]
        });

        // Clean up the pending promise by closing
        fake.emitClose(0);
        await execPromise;
    });

    it('Collect stdout and stderr as buffers when no encoding is provided', async (t: it.TestContext) => {
        const fake = new ExecuteSSHFake();
        const executor = new ExecuteSSH(
            { hostname: 'localhost', username: 'test-user' },
            fake
        );

        const execPromise = executor.execute('echo', 'hello');

        // Let the spawn execute
        await new Promise(resolve => setImmediate(resolve));

        fake.emitStdout('hello ');
        fake.emitStdout('world\n');
        fake.emitStderr('warning: ');
        fake.emitStderr('some warning\n');
        fake.emitClose(0);

        const result = await execPromise;

        t.assert.deepStrictEqual(result.code, 0);
        t.assert.deepStrictEqual(result.stdout, Buffer.from('hello world\n', 'utf-8'));
        t.assert.deepStrictEqual(result.stderr, Buffer.from('warning: some warning\n', 'utf-8'));
    });

    it('Decode and trim stdout and stderr when encoding is specified', async (t: it.TestContext) => {
        const fake = new ExecuteSSHFake();
        const executor = new ExecuteSSH(
            { hostname: 'localhost', username: 'test-user', encoding: 'utf-8' },
            fake
        );

        const execPromise = executor.execute('echo', 'hello');

        // Let the spawn execute
        await new Promise(resolve => setImmediate(resolve));

        fake.emitStdout('  hello world  \n');
        fake.emitStderr('  some warning  \n');
        fake.emitClose(0);

        const result = await execPromise;

        t.assert.deepStrictEqual(result.code, 0);
        t.assert.deepStrictEqual(result.stdout, 'hello world');
        t.assert.deepStrictEqual(result.stderr, 'some warning');
    });

    it('Reject with process error if emitted by the child', async (t: it.TestContext) => {
        const fake = new ExecuteSSHFake();
        const executor = new ExecuteSSH(
            { hostname: 'localhost', username: 'test-user' },
            fake
        );

        const execPromise = executor.execute('ls');

        // Let the spawn execute
        await new Promise(resolve => setImmediate(resolve));

        const expectedError = new Error('Spawn error ENOENT');
        fake.emitError(expectedError);

        await t.assert.rejects(
            execPromise,
            (err: any) => {
                t.assert.deepStrictEqual(err, expectedError);
                return true;
            }
        );
    });

    it('Reject when the spawn itself never hands back a child', async (t: it.TestContext) => {
        const fake = new ExecuteSSHFake();
        const executor = new ExecuteSSH(
            { hostname: 'localhost', username: 'test-user' },
            fake
        );

        const expectedError = new Error('The askpass helper failed to open');
        fake.failSpawn(expectedError);

        // It must settle, and settle as a rejection: an `async` executor would
        // leave this pending forever and leak the rejection to the host process.
        await t.assert.rejects(
            Promise.race([
                executor.execute('ls'),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('execute() never settled')),
                    1000
                ))
            ]),
            (err: any) => {
                t.assert.deepStrictEqual(err, expectedError);
                return true;
            }
        );
    });

    it('Handle close with non-zero exit code and omit stdout/stderr if empty', async (t: it.TestContext) => {
        const fake = new ExecuteSSHFake();
        const executor = new ExecuteSSH(
            { hostname: 'localhost', username: 'test-user' },
            fake
        );

        const execPromise = executor.execute('false');

        // Let the spawn execute
        await new Promise(resolve => setImmediate(resolve));

        fake.emitClose(1);

        const result = await execPromise;

        t.assert.deepStrictEqual(result.code, 1);
        t.assert.deepStrictEqual(result.stdout, undefined);
        t.assert.deepStrictEqual(result.stderr, undefined);
    });

    it('Handle close with non-zero exit code and omit stdout/stderr when empty even with encoding', async (t: it.TestContext) => {
        const fake = new ExecuteSSHFake();
        const executor = new ExecuteSSH(
            { hostname: 'localhost', username: 'test-user', encoding: 'utf-8' },
            fake
        );

        const execPromise = executor.execute('false');

        // Let the spawn execute
        await new Promise(resolve => setImmediate(resolve));

        fake.emitClose(1);

        const result = await execPromise;

        t.assert.deepStrictEqual(result.code, 1);
        t.assert.deepStrictEqual(result.stdout, undefined);
        t.assert.deepStrictEqual(result.stderr, undefined);
    });

    it('Close the stdin of the child, since an execution feeds it nothing', async (t: it.TestContext) => {
        const fake = new ExecuteSSHFake();
        const executor = new ExecuteSSH(
            { hostname: 'localhost', username: 'test-user' },
            fake
        );

        const execPromise = executor.execute('cat');
        await new Promise(resolve => setImmediate(resolve));

        // Without this a remote command that reads its stdin waits forever for
        // input that was never coming, and the execution never returns.
        t.assert.deepStrictEqual(fake.stdinClosed, 1);

        fake.emitClose(0);
        await execPromise;
    });

    it('Reject with the TimeoutError when the deadline is missed', async (t: it.TestContext) => {
        const fake = new ExecuteSSHFake();
        const executor = new ExecuteSSH(
            { hostname: 'localhost', username: 'test-user', timeout: 30000 },
            fake
        );

        const execPromise = executor.execute('sleep', '600');
        await new Promise(resolve => setImmediate(resolve));

        const error = new Error('The command timed out after 30000 ms.');
        error.name = 'TimeoutError';
        fake.emitError(error);

        // Killing the process on its own would arrive here as an ordinary
        // close with a null code, and the caller would never learn that what
        // it is holding is a command that ran out of time.
        await t.assert.rejects(execPromise, (err: Error) => err.name === 'TimeoutError');
    });
});

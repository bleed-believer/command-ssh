import { describe, it } from 'node:test';

import { SpawnSSHRemoteCommand } from './spawn-ssh.remote-command.js';

describe('SpawnSSHRemoteCommand', () => {
    it('Quote the program and every argument by default', (t: it.TestContext) => {
        const command = new SpawnSSHRemoteCommand('ls', [ '-lua' ], false);
        t.assert.deepStrictEqual(command.value(), `'ls' '-lua'`);
    });

    it('Quote a program with no arguments at all', (t: it.TestContext) => {
        const command = new SpawnSSHRemoteCommand('uptime', [], false);
        t.assert.deepStrictEqual(command.value(), `'uptime'`);
    });

    it('Keep an argument with spaces as one remote argument', (t: it.TestContext) => {
        // Unquoted this used to reach the remote shell as `cat my file.txt`,
        // which is two arguments and a missing file.
        const command = new SpawnSSHRemoteCommand('cat', [ 'my file.txt' ], false);
        t.assert.deepStrictEqual(command.value(), `'cat' 'my file.txt'`);
    });

    it('Neutralize a command separator smuggled into an argument', (t: it.TestContext) => {
        const command = new SpawnSSHRemoteCommand('echo', [ 'hi; id > /tmp/pwned' ], false);
        t.assert.deepStrictEqual(command.value(), `'echo' 'hi; id > /tmp/pwned'`);
    });

    it('Neutralize a command substitution smuggled into an argument', (t: it.TestContext) => {
        const command = new SpawnSSHRemoteCommand('echo', [ '$(whoami)' ], false);
        t.assert.deepStrictEqual(command.value(), `'echo' '$(whoami)'`);
    });

    it('Neutralize an argument trying to break out of the quoting', (t: it.TestContext) => {
        const command = new SpawnSSHRemoteCommand('echo', [ `'; id; '` ], false);
        t.assert.deepStrictEqual(command.value(), `'echo' ''\\''; id; '\\'''`);
    });

    it('Hand the command over untouched when the shell is opted into', (t: it.TestContext) => {
        const command = new SpawnSSHRemoteCommand('cd /tmp && ls', [], true);
        t.assert.deepStrictEqual(command.value(), 'cd /tmp && ls');
    });

    it('Join the arguments with no quoting when the shell is opted into', (t: it.TestContext) => {
        const command = new SpawnSSHRemoteCommand('echo', [ '$HOME', '&&', 'id' ], true);
        t.assert.deepStrictEqual(command.value(), 'echo $HOME && id');
    });
});

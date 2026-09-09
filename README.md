# @bleed-believer/command-ssh

Run commands on a remote host over SSH from Node.js.

It shells out to the `ssh` binary you already have, rather than reimplementing
the protocol. What it adds is the part that is genuinely awkward to get right:
**password authentication where the password never touches the `argv`, the
environment, or the disk** — no `sshpass`, no pseudo-terminal.

```ts
import { CommandSSH } from '@bleed-believer/command-ssh';

const ssh = new CommandSSH({
    hostname: 'example.com',
    username: 'deploy',
    password: 'hunter2',
    encoding: 'utf-8'
});

const { code, stdout } = await ssh.execute('ls', '-la', '/srv');
console.log(code, stdout);
```

## Requirements

- **Node.js >= 20**
- **An `ssh` client on the `PATH`.** OpenSSH **8.4 or newer** is recommended:
  that is the version that introduced `SSH_ASKPASS_REQUIRE=force`, which is
  what lets the password be delivered without a terminal. Older versions are
  handled through a `DISPLAY` fallback, which is less reliable.
- **A UNIX-like host** for password authentication: the secret travels through
  a UNIX domain socket.

Public key authentication has none of those constraints — leave `password` out
and `ssh` uses your agent and your keys as usual.

## Install

```sh
npm install @bleed-believer/command-ssh
```

## Usage

### `execute` — run it and collect the output

Resolves once the remote command is over, with its exit code and whatever it
wrote. The stdin of the remote command is closed immediately, so a command that
reads it gets its EOF instead of hanging.

```ts
const ssh = new CommandSSH({
    hostname: 'example.com',
    username: 'deploy',
    encoding: 'utf-8'
});

const { code, stdout, stderr } = await ssh.execute('systemctl', 'is-active', 'nginx');
```

Without `encoding`, `stdout` and `stderr` come back as `Buffer`. With one, they
are `string`, already trimmed. The type follows the option:

```ts
const raw = new CommandSSH({ hostname, username });
(await raw.execute('cat', '/etc/hostname')).stdout;      // Buffer | undefined

const text = new CommandSSH({ hostname, username, encoding: 'utf-8' });
(await text.execute('cat', '/etc/hostname')).stdout;     // string | undefined
```

> When the options are typed as `CommandSSHOptions` rather than inferred from a
> literal, `encoding` is `BufferEncoding | undefined` and no type can tell which
> one it will be at runtime. The result is `string | Buffer | undefined` there,
> and you narrow it. Pass the literal if you want the narrow type.

Either stream is `undefined` when the command wrote nothing to it.

### `spawn` — drive the process yourself

Hands back the live `ChildProcess`, for a command you want to stream, or feed:

```ts
const child = await ssh.spawn('tail', '-f', '/var/log/syslog');

child.stdout.on('data', chunk => process.stdout.write(chunk));
child.on('close', code => console.log('done', code));
```

Its `stdin` is a real, writable pipe, so an interactive remote command works:

```ts
const child = await ssh.spawn('sort');

child.stdin.write('pear\nfig\napple\n');
child.stdin.end();   // the remote command waits for this EOF
```

Every call — `execute` or `spawn` — opens its own connection, with its own
credential helper. Two concurrent commands never share state.

## Options

| Option             | Type                                | Default        | |
|--------------------|-------------------------------------|----------------|-|
| `hostname`         | `string`                            | *required*     | |
| `username`         | `string`                            | *required*     | |
| `password`         | `string`                            | —              | Enables password authentication. Left out, `ssh` uses your keys and agent. |
| `encoding`         | `BufferEncoding`                    | —              | Decodes and trims `stdout`/`stderr` for `execute`. |
| `timeout`          | `number`                            | —              | Milliseconds for the whole thing. See below. |
| `hostKeyChecking`  | `'accept-new' \| 'yes' \| 'no'`     | `'accept-new'` | See below. |
| `shell`            | `boolean`                           | `false`        | See below. |
| `legacyAlgorithms` | `boolean`                           | `false`        | Appends `ssh-rsa` to the negotiable algorithms, for servers that offer nothing newer. Password authentication only. |
| `cwd`              | `string`                            | —              | Working directory of the **local** `ssh` process. |
| `env`              | `NodeJS.ProcessEnv`                 | `process.env`  | Environment of the **local** `ssh` process. |

### `timeout`

There is no default: without one, a command that never returns never returns.
With one, the deadline covers everything — resolving the host, the handshake,
the authentication and the remote command — because from the outside those are
indistinguishable.

On expiry the process is killed with `SIGTERM` and an `error` named
`TimeoutError` is raised on it:

```ts
const ssh = new CommandSSH({ hostname, username, timeout: 30_000 });

try {
    await ssh.execute('sleep', '600');
} catch (error) {
    error.name;   // 'TimeoutError'
}
```

For `spawn`, that error reaches whoever listens — and, as with any `error` of a
child process, nobody listening means it is thrown. **A spawned child with a
timeout owes an `error` listener.**

### `hostKeyChecking`

What `ssh` does when the host key is not the one `known_hosts` expects.

- **`accept-new`** (default) trusts a host it has never seen, and refuses one
  whose key changed. It is the default so that a first connection does not
  fail. It is still trust on first use: a man in the middle on that first
  connection is handed the password.
- **`yes`** refuses anything not already in `known_hosts`. The right setting
  once the host is known, and the recommended one when a `password` is
  involved.
- **`no`** accepts anything, every time. No authentication of the server is
  left.

### `shell`

By default the program and every argument are quoted before being handed to the
remote shell, so an argument is only ever an argument.

`shell: true` sends the command through **unquoted**, which is what makes
pipes, redirections, `&&`, globs and variable expansion work — and what makes
`'hi; rm -rf ~'` a second command rather than an argument:

```ts
// Safe with any input, shell syntax is inert:
await ssh.execute('grep', userInput, '/var/log/app.log');

// Only ever for a fixed script of your own:
const shellSSH = new CommandSSH({ hostname, username, shell: true });
await shellSSH.execute('cat /etc/os-release | grep ^ID=');
```

Never turn it on for a command built from input you did not write yourself.

## How the password is delivered

`ssh` has no option that takes a password, on purpose. The usual workarounds
either put it in the `argv` (visible in `ps` to every user on the machine), in
the environment (readable through `/proc/<pid>/environ`), or on disk.

This library uses the one door OpenSSH leaves open, `SSH_ASKPASS`:

1. A helper script is written into a temporary directory created with `0700`
   permissions, so no other user can even list it. The script contains no
   secret — only the path of a socket.
2. A UNIX domain socket is opened inside that same directory. The password
   exists as a `Buffer` in this process' memory and nowhere else.
3. `ssh` runs with `SSH_ASKPASS_REQUIRE=force`, so it asks the helper instead
   of a terminal. The helper reads the socket and echoes the secret back.
4. The secret is delivered **once**. The buffer is zeroed the moment the bytes
   are on the wire, and any later peer gets nothing — `ssh` runs with
   `NumberOfPasswordPrompts=1`, so whoever asks afterwards is not the helper.
5. The socket and the directory are torn down when the process ends, through a
   hook the consumer cannot detach, plus `exit` and signal handlers for the
   cases where the process is killed outright.

The password never reaches the `argv`, the environment, or the disk.

Beyond that, the `argv` always closes its options with `--`, so a `username`
like `-oProxyCommand=...` stays a (bad) destination rather than becoming an
option `ssh` would obey — which would run a command *locally*, before ever
authenticating.

## License

MIT

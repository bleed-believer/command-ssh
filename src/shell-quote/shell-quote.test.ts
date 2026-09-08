import { describe, it } from 'node:test';

import { ShellQuote } from './shell-quote.js';

describe('ShellQuote', () => {
    it('Wrap a plain value in single quotes', (t: it.TestContext) => {
        t.assert.deepStrictEqual(ShellQuote.of('ls'), `'ls'`);
    });

    it('Keep a value with spaces as a single argument', (t: it.TestContext) => {
        t.assert.deepStrictEqual(ShellQuote.of('my file.txt'), `'my file.txt'`);
    });

    it('Neutralize a command separator', (t: it.TestContext) => {
        t.assert.deepStrictEqual(
            ShellQuote.of('hi; id > /tmp/pwned'),
            `'hi; id > /tmp/pwned'`
        );
    });

    it('Neutralize a command substitution', (t: it.TestContext) => {
        t.assert.deepStrictEqual(ShellQuote.of('$(whoami)'), `'$(whoami)'`);
        t.assert.deepStrictEqual(ShellQuote.of('`whoami`'), '\'`whoami`\'');
    });

    it('Close, escape and reopen an embedded single quote', (t: it.TestContext) => {
        t.assert.deepStrictEqual(ShellQuote.of(`it's`), `'it'\\''s'`);
    });

    it('Neutralize an attempt to break out through a single quote', (t: it.TestContext) => {
        t.assert.deepStrictEqual(
            ShellQuote.of(`'; id; '`),
            `''\\''; id; '\\'''`
        );
    });

    it('Handle an empty value without collapsing the argument', (t: it.TestContext) => {
        t.assert.deepStrictEqual(ShellQuote.of(''), `''`);
    });
});

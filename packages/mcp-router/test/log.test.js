/**
 * Log tests — the stdout/stderr split is a PROTOCOL surface, not cosmetics:
 * stdout is the MCP wire and one stray byte on it corrupts the session, so
 * every router utterance must land on stderr with the tagged one-line shape.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');

const { log, createLog } = require('../src/lib/log.js');

// The family's one identity tag, docs/shared/logging.md: `[@omega.js/<package>:<module>]`.
const TAG = /^\[@omega\.js\/mcp-router:[a-z][\w-]*(?::[\w-]+)*\] /;

// A written line's message, once the identity tag opens it.
const tagged = (line) => (TAG.test(line) ? line.replace(TAG, '') : null);

/**
 * Capture what log() writes to each stream during fn().
 *
 * @param {object} t - The case's ctx, for restore
 * @param {function} fn - The code under test
 * @returns {{ stderr: string, stdout: string }}
 */
function capture(t, fn) {
  const written = { stderr: '', stdout: '' };
  const originals = { stderr: process.stderr.write, stdout: process.stdout.write };

  process.stderr.write = (chunk) => { written.stderr += chunk; return true; };
  process.stdout.write = (chunk) => { written.stdout += chunk; return true; };
  t.after(() => {
    process.stderr.write = originals.stderr;
    process.stdout.write = originals.stdout;
  });

  fn();

  process.stderr.write = originals.stderr;
  process.stdout.write = originals.stdout;
  return written;
}

module.exports = defineCases({
  type: 'group',
  description: 'log',
  tests: [
    {
      name: 'a line opens with the family tag and ends with one newline',
      run: (ctx) => {
        const written = capture(ctx, () => log('info', 'upstream ready'));

        ctx.expect(written.stderr.endsWith('\n') && written.stderr.split('\n').length).toBe(2);
        ctx.expect(tagged(written.stderr), `not the family tag: ${written.stderr}`).toMatch(/upstream ready\n$/);
      },
    },

    {
      name: 'nothing ever reaches stdout — that is the MCP wire',
      run: (ctx) => {
        const written = capture(ctx, () => {
          log('info', 'hello');
          log('warn', 'careful');
          log('error', 'broken');
          log('fatal', 'dead');
        });

        ctx.expect(written.stdout).toBe('');
        const lines = written.stderr.split('\n');
        ctx.expect(lines.pop(), 'every line ends in a newline').toBe('');
        ctx.expect(lines.map((line) => tagged(line) !== null), `untagged: ${lines.join(' | ')}`).toEqual([true, true, true, true]);
        ctx.expect(lines.map((line) => tagged(line).split(' ').pop())).toEqual(['hello', 'careful', 'broken', 'dead']);
      },
    },

    {
      name: 'multiple message parts join with a single space',
      run: (ctx) => {
        const written = capture(ctx, () => log('warn', 'upstream', 'browser', 'exited', 1));

        ctx.expect(tagged(written.stderr), `not the family tag: ${written.stderr}`).toMatch(/(^| )upstream browser exited 1\n$/);
      },
    },

    {
      name: 'a message-less call still writes one tagged line',
      run: (ctx) => {
        const written = capture(ctx, () => log('error'));

        ctx.expect(written.stderr.split('\n').length, 'one line').toBe(2);
        ctx.expect(tagged(written.stderr), `not the family tag: ${written.stderr}`).not.toBe(null);
      },
    },

    {
      name: "the extension server's sink names its own module: [@omega.js/mcp-router:omega-extension] <level>: ...",
      run: (ctx) => {
        const written = capture(ctx, () => createLog('omega-extension')('warn', 'socket', 'closed'));

        ctx.expect(written.stdout).toBe('');
        ctx.expect(written.stderr).toBe('[@omega.js/mcp-router:omega-extension] warn: socket closed\n');
      },
    },
  ],
});

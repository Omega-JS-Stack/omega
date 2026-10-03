/**
 * Log tests — the stdout/stderr split is a PROTOCOL surface, not cosmetics:
 * stdout is the MCP wire and one stray byte on it corrupts the session, so
 * every router utterance must land on stderr with the tagged one-line shape.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');

const { log } = require('../src/lib/log.js');

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
      name: 'a line is tagged with the level and terminated with a newline',
      run: (ctx) => {
        const written = capture(ctx, () => log('info', 'upstream ready'));

        ctx.expect(written.stderr).toBe('[mcp-router info] upstream ready\n');
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
        ctx.expect(written.stderr).toBe([
          '[mcp-router info] hello',
          '[mcp-router warn] careful',
          '[mcp-router error] broken',
          '[mcp-router fatal] dead',
          '',
        ].join('\n'));
      },
    },

    {
      name: 'multiple message parts join with a single space',
      run: (ctx) => {
        const written = capture(ctx, () => log('warn', 'upstream', 'browser', 'exited', 1));

        ctx.expect(written.stderr).toBe('[mcp-router warn] upstream browser exited 1\n');
      },
    },

    {
      name: 'a message-less call still writes one tagged line',
      run: (ctx) => {
        const written = capture(ctx, () => log('error'));

        ctx.expect(written.stderr).toBe('[mcp-router error] \n');
      },
    },
  ],
});

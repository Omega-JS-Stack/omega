/**
 * Log tests — the stdout/stderr split is a PROTOCOL surface, not cosmetics:
 * stdout is the MCP wire and one stray byte on it corrupts the session, so
 * every router utterance must land on stderr with the tagged one-line shape.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { log } = require('../src/lib/log.js');

/**
 * Capture what log() writes to each stream during fn().
 *
 * @param {object} t - The node:test context, for restore
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

test('a line is tagged with the level and terminated with a newline', (t) => {
  const written = capture(t, () => log('info', 'upstream ready'));

  assert.strictEqual(written.stderr, '[mcp-router info] upstream ready\n');
});

test('nothing ever reaches stdout — that is the MCP wire', (t) => {
  const written = capture(t, () => {
    log('info', 'hello');
    log('warn', 'careful');
    log('error', 'broken');
    log('fatal', 'dead');
  });

  assert.strictEqual(written.stdout, '');
  assert.strictEqual(written.stderr, [
    '[mcp-router info] hello',
    '[mcp-router warn] careful',
    '[mcp-router error] broken',
    '[mcp-router fatal] dead',
    '',
  ].join('\n'));
});

test('multiple message parts join with a single space', (t) => {
  const written = capture(t, () => log('warn', 'upstream', 'browser', 'exited', 1));

  assert.strictEqual(written.stderr, '[mcp-router warn] upstream browser exited 1\n');
});

test('a message-less call still writes one tagged line', (t) => {
  const written = capture(t, () => log('error'));

  assert.strictEqual(written.stderr, '[mcp-router error] \n');
});

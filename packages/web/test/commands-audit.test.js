/**
 * `omega audit` — the deliberate NOT-PORTED stub. The command exists so the
 * CLI surface is complete, and its contract is a LOUD failure: an explicit
 * message plus a non-zero exit, never a silent success a CI pipeline would
 * read as "the audit passed". Run in a child process so the real exit code
 * is what gets asserted.
 */
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const COMMAND = path.resolve(__dirname, '..', 'src', 'commands', 'audit.js');

test('audit fails loudly: names itself not-ported and exits non-zero', () => {
  const result = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(COMMAND)})({})`,
  ], { encoding: 'utf8' });

  assert.strictEqual(result.status, 1, 'a not-ported command must never exit 0');
  assert.match(result.stdout + result.stderr, /`omega audit` is not ported yet/);
});

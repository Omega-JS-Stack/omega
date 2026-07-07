// Unit tests for src/cli-router.js — the shared framework CLI dispatcher.
//
// Fixture command modules live in test/fixtures/cli-commands/; each records its
// run by mutating the options object the test passes in (no globals), matching
// the real command contract: module.exports = async (options) => {}.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createCliRouter } = require('../src/cli-router');

const COMMANDS_DIR = path.join(__dirname, 'fixtures', 'cli-commands');

const ALIASES = {
  install: ['-i', 'i', '--install'],
  setup: ['-s', '--setup'],
  version: ['-v', '--version'],
};

function makeMain(overrides) {
  const Main = createCliRouter({
    commandsDir: COMMANDS_DIR,
    aliases: ALIASES,
    ...overrides,
  });
  return new Main();
}

test('exports createCliRouter as a function', () => {
  assert.equal(typeof createCliRouter, 'function');
});

test('throws without commandsDir', () => {
  assert.throws(() => createCliRouter({}), /commandsDir is required/);
});

test('exposes the resolved dispatch table as Main.config', () => {
  const Main = createCliRouter({ commandsDir: COMMANDS_DIR, aliases: ALIASES });
  assert.equal(Main.config.commandsDir, COMMANDS_DIR);
  assert.deepEqual(Main.config.aliases, ALIASES);
  assert.equal(Main.config.defaultCommand, 'setup');
});

test('positional command name runs the matching module', async () => {
  const options = { _: ['version'] };
  await makeMain().process(options);
  assert.equal(options.__ran, 'version');
});

test('positional alias resolves to its command', async () => {
  const options = { _: ['i'] };
  await makeMain().process(options);
  assert.equal(options.__ran, 'install');
});

test('flag-style alias resolves to its command', async () => {
  const options = { _: [], v: true };
  await makeMain().process(options);
  assert.equal(options.__ran, 'version');
});

test('no positional or flag falls back to the default command (setup)', async () => {
  const options = { _: [] };
  await makeMain().process(options);
  assert.equal(options.__ran, 'setup');
});

test('defaultCommand override is honored', async () => {
  const options = { _: [] };
  await makeMain({ defaultCommand: 'version' }).process(options);
  assert.equal(options.__ran, 'version');
});

test('unknown positional passes through and rejects on the missing file', async () => {
  await assert.rejects(
    () => makeMain().process({ _: ['nope'] }),
    /Command "nope" not found/,
  );
});

test('command errors are rethrown to the bin', async () => {
  await assert.rejects(
    () => makeMain().process({ _: ['boom'] }),
    /kaboom/,
  );
});

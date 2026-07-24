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

// Capture console output + exit code around a process() call, restoring after.
async function captured(fn) {
  const out = [];
  const err = [];
  const origLog = console.log;
  const origError = console.error;
  const origExitCode = process.exitCode;
  console.log = (...args) => out.push(args.join(' '));
  console.error = (...args) => err.push(args.join(' '));
  try {
    await fn();
    return { out: out.join('\n'), err: err.join('\n'), exitCode: process.exitCode };
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exitCode = origExitCode;
  }
}

test('unknown positional prints the available-command listing and sets exit code 1 (no throw)', async () => {
  const { err, exitCode } = await captured(() => makeMain().process({ _: ['nope'] }));
  assert.match(err, /Unknown command "nope"/);
  assert.match(err, /Available: boom, install, setup, version/);
  assert.equal(exitCode, 1);
});

test('command errors surface once (own stack, exit code 1) with no wrapper prefix or rethrow', async () => {
  const { err, exitCode } = await captured(() => makeMain().process({ _: ['boom'] }));
  assert.match(err, /kaboom/);
  assert.doesNotMatch(err, /Error executing command/);
  assert.equal(exitCode, 1);
});

test('--help routes to the built-in help, never the default command', async () => {
  const options = { _: [], help: true };
  const { out } = await captured(() => makeMain().process(options));
  assert.equal(options.__ran, undefined);
  assert.match(out, /Usage: omega <command>/);
  assert.match(out, /install \(-i, i, --install\)/);
  assert.match(out, /setup \(-s, --setup\) \[default\]/);
});

test('--help beats a positional command — `omega deploy --help` must never RUN deploy', async () => {
  const options = { _: ['install'], help: true };
  const { out } = await captured(() => makeMain().process(options));
  assert.equal(options.__ran, undefined);
  assert.match(out, /Usage: omega <command>/);
});

test('positional "help" and -h reach the same built-in help', async () => {
  const positional = await captured(() => makeMain().process({ _: ['help'] }));
  assert.match(positional.out, /Usage: omega <command>/);
  const shortFlag = await captured(() => makeMain().process({ _: [], h: true }));
  assert.match(shortFlag.out, /Usage: omega <command>/);
});

// Unit tests for src/attach-log-file.js — tee process.stdout/stderr to a file with
// ANSI stripping. Ported from BXM/EM's build-layer suites (same assertions, node:test).
//
// Uses throwaway createTee() instances so the tests never touch the process-wide
// singleton — detaching the singleton mid-run would clobber any live log tee.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const attachLogFile = require('../src/attach-log-file');

test('exports the expected surface', () => {
  assert.equal(typeof attachLogFile, 'function');
  assert.equal(typeof attachLogFile.detach, 'function');
  assert.equal(typeof attachLogFile.stripAnsi, 'function');
  assert.equal(typeof attachLogFile.createTee, 'function');
});

test('stripAnsi removes color escape codes', () => {
  const colored = '\x1B[31mred\x1B[0m and \x1B[32mgreen\x1B[0m';
  assert.equal(attachLogFile.stripAnsi(colored), 'red and green');
});

test('attach + stdout.write + detach: file contains the writes, ANSI-stripped', async () => {
  const tee = attachLogFile.createTee();
  const tmpPath = path.join(os.tmpdir(), `devkit-log-${Date.now()}.log`);
  try {
    const stream = tee.attach(tmpPath);
    process.stdout.write('hello world\n');
    process.stdout.write('\x1B[31mcolored\x1B[0m line\n');
    // Wait for the stream to flush before detaching + reading.
    await new Promise((resolve) => stream.write('', resolve));
    await tee.detach();

    const contents = fs.readFileSync(tmpPath, 'utf8');
    assert.match(contents, /hello world/);
    assert.match(contents, /colored line/);
    assert.ok(!contents.includes('\x1B['));
    assert.match(contents, /^# omega log — /); // self-documenting header
  } finally {
    await tee.detach();
    try { fs.unlinkSync(tmpPath); } catch (e) { /* already gone */ }
  }
});

test('idempotent: attaching twice with same path returns same stream', async () => {
  const tee = attachLogFile.createTee();
  const tmpPath = path.join(os.tmpdir(), `devkit-log-idem-${Date.now()}.log`);
  try {
    const s1 = tee.attach(tmpPath);
    const s2 = tee.attach(tmpPath);
    assert.equal(s1, s2);
  } finally {
    await tee.detach();
    try { fs.unlinkSync(tmpPath); } catch (e) { /* already gone */ }
  }
});

test('attach with falsy path returns null and does nothing', () => {
  const tee = attachLogFile.createTee();
  assert.equal(tee.attach(null), null);
  assert.equal(tee.attach(''), null);
});

// Unit tests for src/test/boot-child.js — the e2e lanes' child boot/stop.
//
// Real execution only: every case spawns a REAL node child that prints real
// lines on real pipes, because everything this module owns (marker matching
// across chunk boundaries, the log tee, early exit, the group stop) only
// exists at that boundary. A stubbed spawn would prove none of it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const { startChild, stopChild } = require('../src/test/boot-child.js');

function scratch() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boot-child-')));
}

/** A child that prints `lines` (each after `delay` ms) and then runs forever. */
function foreverScript(lines, delay = 30) {
  return `${lines.map((line, index) => `setTimeout(() => process.stdout.write(${JSON.stringify(`${line}\n`)}), ${delay * (index + 1)});`).join('')}setInterval(() => {}, 1000);`;
}

test('startChild resolves the marker capture group and tees the output to its log', async () => {
  const dir = scratch();
  const logFile = path.join(dir, 'logs', 'dev.log');

  const { child, ready } = startChild({
    bin: process.execPath,
    args: ['-e', foreverScript(['booting the fixture', 'Dev server: http://localhost:41234'])],
    cwd: dir,
    logFile,
    marker: /Dev server: (https?:\/\/localhost:\d+)/,
    timeout: 20000,
    relativeTo: dir,
  });

  try {
    assert.equal(await ready, 'http://localhost:41234');
    const contents = fs.readFileSync(logFile, 'utf8');
    assert.match(contents, /booting the fixture/, 'the pre-marker output landed in the log too');
    assert.match(contents, /Dev server: http:\/\/localhost:41234/);
  } finally {
    await stopChild(child);
  }
});

test('a marker with no capture group resolves null', async () => {
  const dir = scratch();
  const { child, ready } = startChild({
    bin: process.execPath,
    args: ['-e', foreverScript(['Emulator ready. Press Ctrl+C to exit'])],
    cwd: dir,
    logFile: path.join(dir, 'emulator.log'),
    marker: /Emulator ready\. Press Ctrl\+C/i,
    timeout: 20000,
  });

  try {
    assert.equal(await ready, null);
  } finally {
    await stopChild(child);
  }
});

test('a marker split across two reads still matches (the buffer, not the chunk)', async () => {
  const dir = scratch();
  // Two writes, no newline between them: the marker only exists across both.
  const script = 'process.stdout.write("Dev server: http://loc");'
    + 'setTimeout(() => process.stdout.write("alhost:41235\\n"), 80);'
    + 'setInterval(() => {}, 1000);';

  const { child, ready } = startChild({
    bin: process.execPath,
    args: ['-e', script],
    cwd: dir,
    logFile: path.join(dir, 'dev.log'),
    marker: /Dev server: (https?:\/\/localhost:\d+)/,
    timeout: 20000,
  });

  try {
    assert.equal(await ready, 'http://localhost:41235');
  } finally {
    await stopChild(child);
  }
});

test('a child that dies before its marker rejects with the code and the log path', async () => {
  const dir = scratch();
  const logFile = path.join(dir, 'emulator.log');

  const { ready } = startChild({
    bin: process.execPath,
    args: ['-e', 'process.stdout.write("port 8080 is taken\\n"); process.exit(3);'],
    cwd: dir,
    logFile,
    marker: /never printed/,
    timeout: 20000,
    relativeTo: dir,
  });

  await assert.rejects(() => ready, /exited early \(code 3, log: emulator\.log\)/);
  assert.match(fs.readFileSync(logFile, 'utf8'), /port 8080 is taken/, 'the reason is on disk, not only in the rejection');
});

test('a child that never prints its marker rejects on the timeout', async () => {
  const dir = scratch();
  const { child, ready } = startChild({
    bin: process.execPath,
    args: ['-e', foreverScript(['still warming up'])],
    cwd: dir,
    logFile: path.join(dir, 'dev.log'),
    marker: /Dev server: (\S+)/,
    timeout: 300,
    relativeTo: dir,
  });

  try {
    await assert.rejects(() => ready, /not ready after 0\.3s \(log: dev\.log\)/);
  } finally {
    await stopChild(child);
  }
});

test('stopChild ends the whole process group, and the child releases what it held', async () => {
  const dir = scratch();
  // A child holding a port is the real case: an emulator whose port stays
  // bound is an emulator the next lane cannot boot.
  const port = 46031;
  const script = `const net = require('net');`
    + `net.createServer().listen(${port}, '127.0.0.1', () => process.stdout.write('holding\\n'));`;

  const { child, ready } = startChild({
    bin: process.execPath,
    args: ['-e', script],
    cwd: dir,
    logFile: path.join(dir, 'held.log'),
    marker: /(holding)/,
    timeout: 20000,
  });

  await ready;
  await stopChild(child);

  assert.notEqual(child.exitCode === null && child.signalCode === null, true, 'the child is gone');
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
});

test('stopChild on an already-exited child is a no-op', async () => {
  const dir = scratch();
  const { child, ready } = startChild({
    bin: process.execPath,
    args: ['-e', 'process.exit(0);'],
    cwd: dir,
    logFile: path.join(dir, 'gone.log'),
    marker: /never/,
    timeout: 20000,
  });

  await assert.rejects(() => ready);
  await stopChild(child);
  await stopChild(child);
});

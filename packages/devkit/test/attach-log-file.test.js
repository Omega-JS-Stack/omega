/**
 * attach-log-file tests — the stdout/stderr tee. Real execution, no mocks: every
 * test drives the actual writer patch, writes real bytes, and reads the real file
 * from a per-pid .temp scratch dir. The crash-tail case spawns a real child that
 * dies on an uncaught throw.
 *
 * Every attach passes an explicit `env` so the CI skip is exercised deliberately
 * and the suite behaves the same on a laptop and on a runner.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const attachLogFile = require('../src/attach-log-file.js');

const MODULE_PATH = path.join(__dirname, '..', 'src', 'attach-log-file.js');
const SCRATCH = path.join(__dirname, '..', '.temp', `attach-log-file-${process.pid}`);
const NO_CI = { env: {} };

function scratchFile(name) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  return path.join(SCRATCH, name);
}

// Swap in a collector for the terminal writers and hand back the restore. The spy
// FORWARDS every chunk to the real writer — this file runs under `node --test`, whose
// result stream is this process's stdout — EXCEPT a stdout string, which the spy
// swallows: this file is the one place that asserts on stream routing, and below
// the spy sits the stdout guard (#356), which sends a string on to STDERR and would
// cross the two collectors. Only the runner's own frames (Buffers) need to pass.
function spyWriters() {
  const chunks = { stdout: [], stderr: [] };
  const priorStdout = process.stdout.write;
  const priorStderr = process.stderr.write;
  process.stdout.write = function (...args) { chunks.stdout.push(String(args[0])); return typeof args[0] === 'string' ? true : priorStdout.apply(process.stdout, args); };
  process.stderr.write = function (...args) { chunks.stderr.push(String(args[0])); return priorStderr.apply(process.stderr, args); };
  return {
    chunks,
    stdoutSpy: process.stdout.write,
    stderrSpy: process.stderr.write,
    restore: () => {
      process.stdout.write = priorStdout;
      process.stderr.write = priorStderr;
    },
  };
}

test('exports the expected surface', () => {
  assert.equal(typeof attachLogFile, 'function');
  assert.equal(typeof attachLogFile.detach, 'function');
  assert.equal(typeof attachLogFile.stripAnsi, 'function');
  assert.equal(typeof attachLogFile.createTee, 'function');
  assert.equal(typeof attachLogFile.createChildLog, 'function');
});

test('stripAnsi removes color escape codes', () => {
  const colored = '\x1B[31mred\x1B[0m and \x1B[32mgreen\x1B[0m';
  assert.equal(attachLogFile.stripAnsi(colored), 'red and green');
});

test('both sinks: the terminal keeps the ANSI codes, the file gets them stripped', (t) => {
  const logPath = scratchFile('both-sinks.log');
  t.after(() => fs.rmSync(logPath, { force: true }));

  const spy = spyWriters();
  const tee = attachLogFile.createTee();
  let detach;
  try {
    detach = tee.attach(logPath, NO_CI);
    process.stdout.write('\x1B[31mred out\x1B[0m\n');
    process.stderr.write('\x1B[32mgreen err\x1B[0m\n');
  } finally {
    if (detach) { detach(); }
    spy.restore();
  }

  // Terminal side: untouched, colors intact.
  assert.deepEqual(spy.chunks.stdout, ['\x1B[31mred out\x1B[0m\n']);
  assert.deepEqual(spy.chunks.stderr, ['\x1B[32mgreen err\x1B[0m\n']);

  // File side: same lines, no escape codes.
  const contents = fs.readFileSync(logPath, 'utf8');
  assert.match(contents, /^# omega log — /);
  assert.match(contents, /^red out$/m);
  assert.match(contents, /^green err$/m);
  assert.ok(!contents.includes('\x1B['), 'file must not contain ANSI escapes');
});

test('attach truncates an existing log file', (t) => {
  const logPath = scratchFile('truncate.log');
  t.after(() => fs.rmSync(logPath, { force: true }));
  fs.writeFileSync(logPath, 'STALE LINE FROM THE PREVIOUS RUN\n');

  const spy = spyWriters();
  const tee = attachLogFile.createTee();
  let detach;
  try {
    detach = tee.attach(logPath, NO_CI);
    process.stdout.write('fresh line\n');
  } finally {
    if (detach) { detach(); }
    spy.restore();
  }

  const contents = fs.readFileSync(logPath, 'utf8');
  assert.ok(!contents.includes('STALE LINE'), 'previous run must be cleared');
  assert.match(contents, /^fresh line$/m);
});

test('attach creates a missing parent directory', (t) => {
  const logPath = path.join(SCRATCH, 'nested', 'deeper', 'made.log');
  t.after(() => fs.rmSync(path.join(SCRATCH, 'nested'), { recursive: true, force: true }));

  const spy = spyWriters();
  const tee = attachLogFile.createTee();
  let detach;
  try {
    detach = tee.attach(logPath, NO_CI);
    process.stdout.write('nested line\n');
  } finally {
    if (detach) { detach(); }
    spy.restore();
  }

  assert.match(fs.readFileSync(logPath, 'utf8'), /^nested line$/m);
});

test('nested tees fan out; LIFO detach leaves the outer file intact and still receiving', (t) => {
  const outerPath = scratchFile('outer.log');
  const innerPath = scratchFile('inner.log');
  t.after(() => {
    fs.rmSync(outerPath, { force: true });
    fs.rmSync(innerPath, { force: true });
  });

  const spy = spyWriters();
  const outer = attachLogFile.createTee();
  const inner = attachLogFile.createTee();
  let detachOuter;
  let detachInner;
  try {
    detachOuter = outer.attach(outerPath, NO_CI);
    detachInner = inner.attach(innerPath, NO_CI);

    process.stdout.write('both tees\n');

    detachInner();
    detachInner = null;

    process.stdout.write('outer only\n');
  } finally {
    if (detachInner) { detachInner(); }
    if (detachOuter) { detachOuter(); }
    spy.restore();
  }

  const outerContents = fs.readFileSync(outerPath, 'utf8');
  const innerContents = fs.readFileSync(innerPath, 'utf8');

  // The legacy bug: the inner attach truncated / stole the outer tee's sink, so the
  // outer file lost everything written before the inner detach and everything after it.
  assert.match(outerContents, /^both tees$/m);
  assert.match(outerContents, /^outer only$/m);
  assert.match(innerContents, /^both tees$/m);
  assert.ok(!innerContents.includes('outer only'), 'a detached tee must stop receiving');

  // Both sinks fanned out to the terminal exactly once per write.
  assert.deepEqual(spy.chunks.stdout, ['both tees\n', 'outer only\n']);
});

test('detach restores the exact prior writers', () => {
  const logPath = scratchFile('restore.log');
  const spy = spyWriters();
  try {
    const tee = attachLogFile.createTee();
    const detach = tee.attach(logPath, NO_CI);
    assert.notEqual(process.stdout.write, spy.stdoutSpy, 'attach must patch stdout');
    assert.notEqual(process.stderr.write, spy.stderrSpy, 'attach must patch stderr');

    detach();
    assert.equal(process.stdout.write, spy.stdoutSpy);
    assert.equal(process.stderr.write, spy.stderrSpy);

    // Detaching twice is harmless and does not re-restore a stale writer.
    detach();
    assert.equal(process.stdout.write, spy.stdoutSpy);
  } finally {
    spy.restore();
    fs.rmSync(logPath, { force: true });
  }
});

test('idempotent: attaching the same path twice does not double-write lines', (t) => {
  const logPath = scratchFile('idempotent.log');
  t.after(() => fs.rmSync(logPath, { force: true }));

  const spy = spyWriters();
  const tee = attachLogFile.createTee();
  let detach;
  try {
    detach = tee.attach(logPath, NO_CI);
    const again = tee.attach(logPath, NO_CI);
    assert.equal(again, detach, 'the second attach returns the live detach');
    process.stdout.write('only once\n');
  } finally {
    if (detach) { detach(); }
    spy.restore();
  }

  const occurrences = fs.readFileSync(logPath, 'utf8').split('only once').length - 1;
  assert.equal(occurrences, 1);
});

test('CI: attach is a no-op that returns a no-op detach', () => {
  const logPath = scratchFile('ci.log');
  fs.rmSync(logPath, { force: true });

  const spy = spyWriters();
  try {
    for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
      const tee = attachLogFile.createTee();
      const detach = tee.attach(logPath, { env });
      assert.equal(typeof detach, 'function');
      assert.equal(process.stdout.write, spy.stdoutSpy, 'CI must leave stdout alone');
      assert.equal(process.stderr.write, spy.stderrSpy, 'CI must leave stderr alone');
      detach();
      assert.equal(process.stdout.write, spy.stdoutSpy);
    }
  } finally {
    spy.restore();
  }

  assert.equal(fs.existsSync(logPath), false, 'CI must not create a log file');
});

test('a falsy path is a no-op that returns a no-op detach', () => {
  const spy = spyWriters();
  try {
    const tee = attachLogFile.createTee();
    for (const value of [null, '', undefined]) {
      const detach = tee.attach(value, NO_CI);
      assert.equal(typeof detach, 'function');
      assert.equal(process.stdout.write, spy.stdoutSpy);
      detach();
    }
  } finally {
    spy.restore();
  }
});

test('an unopenable log path warns once and proceeds without a tee', (t) => {
  // Parent is a FILE, so both mkdir and open fail (ENOTDIR) without needing a
  // permissions dance that root would sail through.
  const blocker = scratchFile('blocker');
  fs.writeFileSync(blocker, 'not a directory\n');
  t.after(() => fs.rmSync(blocker, { force: true }));
  const logPath = path.join(blocker, 'impossible.log');

  const spy = spyWriters();
  let first;
  let second;
  try {
    const tee = attachLogFile.createTee();
    first = tee.attach(logPath, NO_CI);
    assert.equal(process.stdout.write, spy.stdoutSpy, 'a failed attach must not patch stdout');
    second = tee.attach(logPath, NO_CI);
    // The process it observes keeps running.
    process.stdout.write('still alive\n');
  } finally {
    spy.restore();
  }

  assert.equal(typeof first, 'function');
  assert.equal(typeof second, 'function');
  assert.deepEqual(spy.chunks.stdout, ['still alive\n']);

  const warnings = spy.chunks.stderr.map((chunk) => attachLogFile.stripAnsi(chunk)).join('');
  assert.match(warnings, /\[@omega\.js\/devkit:attach-log-file\]/);
  assert.match(warnings, /impossible\.log/);
  assert.equal(warnings.split('@omega.js/devkit:attach-log-file').length - 1, 1, 'warns once, not per attempt');
});

test('crash tail: the last lines before a fatal throw land in the file', (t) => {
  const logPath = scratchFile('crash.log');
  const scriptPath = scratchFile('crash-child.js');
  t.after(() => {
    fs.rmSync(logPath, { force: true });
    fs.rmSync(scriptPath, { force: true });
  });

  fs.writeFileSync(scriptPath, [
    `const attachLogFile = require(${JSON.stringify(MODULE_PATH)});`,
    `attachLogFile(${JSON.stringify(logPath)}, { env: {} });`,
    "console.log('first line');",
    "console.log('the last line before the crash');",
    "throw new Error('boom');",
    '',
  ].join('\n'));

  const child = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  assert.notEqual(child.status, 0, 'the child must actually die');

  const contents = fs.readFileSync(logPath, 'utf8');
  assert.match(contents, /^first line$/m);
  // The line written in the same tick as the throw: a buffered stream loses this one.
  assert.match(contents, /^the last line before the crash$/m);

  // Node dumps a fatal exception straight to fd 2, below any userland write patch, so the
  // stack reaches the terminal but never the tee. Pinned so it reads as known, not broken.
  assert.match(child.stderr, /Error: boom/);
  assert.ok(!contents.includes('Error: boom'));
});

// ---- createChildLog: the sink for a SPAWNED process' piped output ----------
// The reset-sentinel roll and the truncate-on-open are what BEM's emulator and
// serve commands each carried a copy of; these pin the one implementation.

// Wait for a condition the 500ms-class poller satisfies, without sleeping a
// fixed amount (a fixed sleep is either flaky or slow).
async function until(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) { return true; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test('child log: writes land ANSI-stripped in a file that opened truncated', (t) => {
  const logPath = scratchFile('child.log');
  t.after(() => fs.rmSync(logPath, { force: true }));
  fs.writeFileSync(logPath, 'STALE LINE FROM THE PREVIOUS RUN\n');

  const childLog = attachLogFile.createChildLog({ logPath });
  childLog.write(Buffer.from('\x1B[32mchild says hi\x1B[0m\n'));
  childLog.close();

  const contents = fs.readFileSync(logPath, 'utf8');
  assert.ok(!contents.includes('STALE LINE'), 'the previous run must be cleared');
  assert.match(contents, /^child says hi$/m);
  assert.ok(!contents.includes('\x1B['), 'the file must be ANSI-free');
});

test('child log: a touched reset sentinel rolls the log mid-run and is consumed', async (t) => {
  const logPath = scratchFile('child-roll.log');
  const resetPath = scratchFile('child-roll.log.reset');
  t.after(() => {
    fs.rmSync(logPath, { force: true });
    fs.rmSync(resetPath, { force: true });
  });

  const childLog = attachLogFile.createChildLog({ logPath, resetPath, pollMs: 25 });
  try {
    childLog.write('before the reset\n');

    // Another process asking this long-lived log for a fresh start.
    fs.writeFileSync(resetPath, '');
    assert.ok(await until(() => !fs.existsSync(resetPath)), 'the sentinel must be consumed');

    childLog.write('after the reset\n');
    assert.ok(await until(() => fs.readFileSync(logPath, 'utf8').includes('after the reset')));
  } finally {
    childLog.close();
  }

  const contents = fs.readFileSync(logPath, 'utf8');
  assert.ok(!contents.includes('before the reset'), 'the roll must clear the pre-reset run');
  assert.match(contents, /^after the reset$/m);
});

test('child log: a sentinel left by a crashed run never rolls the fresh log', async (t) => {
  const logPath = scratchFile('child-stale.log');
  const resetPath = scratchFile('child-stale.log.reset');
  t.after(() => {
    fs.rmSync(logPath, { force: true });
    fs.rmSync(resetPath, { force: true });
  });
  fs.writeFileSync(resetPath, '');

  const childLog = attachLogFile.createChildLog({ logPath, resetPath, pollMs: 25 });
  try {
    childLog.write('this run keeps its output\n');
    // Long enough for several polls of a sentinel that must already be gone.
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(await until(() => fs.readFileSync(logPath, 'utf8').includes('this run keeps its output')));
  } finally {
    childLog.close();
  }

  assert.equal(fs.existsSync(resetPath), false, 'close() leaves no sentinel behind');
});

test('child log: an unopenable path warns once and drops the rest in silence', (t) => {
  // Parent is a FILE, so both mkdir and open fail (ENOTDIR) — same trick the
  // tee's unopenable case uses, no permissions dance.
  const blocker = scratchFile('child-blocker');
  fs.writeFileSync(blocker, 'not a directory\n');
  t.after(() => fs.rmSync(blocker, { force: true }));
  const logPath = path.join(blocker, 'impossible.log');

  const spy = spyWriters();
  let childLog;
  try {
    childLog = attachLogFile.createChildLog({ logPath });
    childLog.write('first chunk the child produced\n');
    childLog.write('second chunk\n');
    childLog.write('third chunk\n');
    childLog.close();
    // The process it observes keeps running.
    process.stdout.write('still alive\n');
  } finally {
    spy.restore();
  }

  assert.deepEqual(spy.chunks.stdout, ['still alive\n'], 'a dropped write never reaches the terminal twice');

  const warnings = spy.chunks.stderr.map((chunk) => attachLogFile.stripAnsi(chunk)).join('');
  assert.match(warnings, /\[@omega\.js\/devkit:attach-log-file\]/);
  assert.match(warnings, /impossible\.log/);
  assert.equal(warnings.split('@omega.js/devkit:attach-log-file').length - 1, 1, 'warns once, not per chunk');
});

test('child log: writes after close() stay silent — a closed sink is not a broken one', (t) => {
  const logPath = scratchFile('child-closed.log');
  t.after(() => fs.rmSync(logPath, { force: true }));

  const spy = spyWriters();
  try {
    const childLog = attachLogFile.createChildLog({ logPath });
    childLog.close();
    childLog.write('a chunk that arrived after teardown\n');
  } finally {
    spy.restore();
  }

  assert.deepEqual(spy.chunks.stderr, [], 'no warning for a log that opened fine and was closed');
});

/**
 * attach-log-file tests — the stdout/stderr tee. Real execution, no mocks: every
 * test drives the actual writer patch, writes real bytes, and reads the real file
 * from a per-pid .temp scratch dir. The crash-tail case spawns a real child that
 * dies on an uncaught throw.
 *
 * Every attach passes an explicit `env` so the CI skip is exercised deliberately
 * and the suite behaves the same on a laptop and on a runner.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'attach-log-file',
  tests: [
    {
      name: 'exports the expected surface',
      run: (ctx) => {
        ctx.expect(typeof attachLogFile).toBe('function');
        ctx.expect(typeof attachLogFile.detach).toBe('function');
        ctx.expect(typeof attachLogFile.mark).toBe('function');
        ctx.expect(typeof attachLogFile.stripAnsi).toBe('function');
        ctx.expect(typeof attachLogFile.createTee).toBe('function');
        ctx.expect(typeof attachLogFile.createChildLog).toBe('function');
      },
    },

    {
      name: 'stripAnsi removes color escape codes',
      run: (ctx) => {
        const colored = '\x1B[31mred\x1B[0m and \x1B[32mgreen\x1B[0m';
        ctx.expect(attachLogFile.stripAnsi(colored)).toBe('red and green');
      },
    },

    {
      name: 'both sinks: the terminal keeps the ANSI codes, the file gets them stripped',
      run: (ctx) => {
        const logPath = scratchFile('both-sinks.log');
        ctx.after(() => fs.rmSync(logPath, { force: true }));

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
        ctx.expect(spy.chunks.stdout).toEqual(['\x1B[31mred out\x1B[0m\n']);
        ctx.expect(spy.chunks.stderr).toEqual(['\x1B[32mgreen err\x1B[0m\n']);

        // File side: same lines, no escape codes.
        const contents = fs.readFileSync(logPath, 'utf8');
        ctx.expect(contents).toMatch(/^# omega log — /);
        ctx.expect(contents).toMatch(/^red out$/m);
        ctx.expect(contents).toMatch(/^green err$/m);
        ctx.expect(!contents.includes('\x1B['), 'file must not contain ANSI escapes').toBeTruthy();
      },
    },

    {
      name: 'attach truncates an existing log file',
      run: (ctx) => {
        const logPath = scratchFile('truncate.log');
        ctx.after(() => fs.rmSync(logPath, { force: true }));
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
        ctx.expect(!contents.includes('STALE LINE'), 'previous run must be cleared').toBeTruthy();
        ctx.expect(contents).toMatch(/^fresh line$/m);
      },
    },

    {
      name: 'attach creates a missing parent directory',
      run: (ctx) => {
        const logPath = path.join(SCRATCH, 'nested', 'deeper', 'made.log');
        ctx.after(() => fs.rmSync(path.join(SCRATCH, 'nested'), { recursive: true, force: true }));

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

        ctx.expect(fs.readFileSync(logPath, 'utf8')).toMatch(/^nested line$/m);
      },
    },

    {
      name: 'nested tees fan out; LIFO detach leaves the outer file intact and still receiving',
      run: (ctx) => {
        const outerPath = scratchFile('outer.log');
        const innerPath = scratchFile('inner.log');
        ctx.after(() => {
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
        ctx.expect(outerContents).toMatch(/^both tees$/m);
        ctx.expect(outerContents).toMatch(/^outer only$/m);
        ctx.expect(innerContents).toMatch(/^both tees$/m);
        ctx.expect(!innerContents.includes('outer only'), 'a detached tee must stop receiving').toBeTruthy();

        // Both sinks fanned out to the terminal exactly once per write.
        ctx.expect(spy.chunks.stdout).toEqual(['both tees\n', 'outer only\n']);
      },
    },

    {
      name: 'the singleton stacks too: a second attach layers instead of replacing',
      run: (ctx) => {
        // Same shape as the nested-tees case above, but through the process-wide
        // singleton: a verb that runs another verb in process (`omega test` running
        // `omega deploy`) attaches a second path on the SAME tee, and the first file
        // must keep receiving once the second layer comes off.
        const outerPath = scratchFile('singleton-outer.log');
        const innerPath = scratchFile('singleton-inner.log');
        ctx.after(() => {
          fs.rmSync(outerPath, { force: true });
          fs.rmSync(innerPath, { force: true });
        });

        const spy = spyWriters();
        const detachOuter = attachLogFile(outerPath, NO_CI);
        const detachInner = attachLogFile(innerPath, NO_CI);
        try {
          process.stdout.write('both layers\n');

          // The module-level detach pops the NEWEST layer, the inner one.
          attachLogFile.detach();

          process.stdout.write('outer only\n');
        } finally {
          // Each layer's own handle, never a second module-level pop: this suite may
          // itself run under a live singleton tee, and a blind pop would take it.
          detachInner();
          detachOuter();
          spy.restore();
        }

        const outerContents = fs.readFileSync(outerPath, 'utf8');
        const innerContents = fs.readFileSync(innerPath, 'utf8');

        ctx.expect(outerContents).toMatch(/^both layers$/m);
        ctx.expect(outerContents, 'the outer layer must survive the inner detach').toMatch(/^outer only$/m);
        ctx.expect(innerContents).toMatch(/^both layers$/m);
        ctx.expect(!innerContents.includes('outer only'), 'a detached layer must stop receiving').toBeTruthy();

        // Both layers fanned out to the terminal exactly once per write.
        ctx.expect(spy.chunks.stdout).toEqual(['both layers\n', 'outer only\n']);
      },
    },

    {
      name: 'mark() hands back a restore that takes off exactly what the run pushed',
      run: (ctx) => {
        // A harness around a verb marks the singleton stack first and restores to the
        // mark after, whatever the verb did: pushed one layer, pushed several, pushed
        // none (declined under CI) or already popped its own. The outer layer (the
        // `omega test` log the harness itself runs under) survives every one.
        const outerPath = scratchFile('mark-outer.log');
        const pushedPath = scratchFile('mark-pushed.log');
        const secondPath = scratchFile('mark-second.log');
        const poppedPath = scratchFile('mark-popped.log');
        ctx.after(() => {
          for (const file of [outerPath, pushedPath, secondPath, poppedPath]) fs.rmSync(file, { force: true });
        });

        const spy = spyWriters();
        const detachOuter = attachLogFile(outerPath, NO_CI);
        try {
          // Pushed two layers.
          let restoreTee = attachLogFile.mark();
          attachLogFile(pushedPath, NO_CI);
          attachLogFile(secondPath, NO_CI);
          process.stdout.write('run one\n');
          restoreTee();
          process.stdout.write('after run one\n');

          // Pushed none: the attach declined under a runner.
          restoreTee = attachLogFile.mark();
          attachLogFile(pushedPath, { env: { CI: 'true' } });
          restoreTee();
          process.stdout.write('after run two\n');

          // Already popped its own layer.
          restoreTee = attachLogFile.mark();
          attachLogFile(poppedPath, NO_CI)();
          restoreTee();
          process.stdout.write('after run three\n');
        } finally {
          detachOuter();
          spy.restore();
        }

        const outer = fs.readFileSync(outerPath, 'utf8');
        ctx.expect(outer).toMatch(/^run one$/m);
        ctx.expect(outer, 'the restore left the outer layer in place').toMatch(/^after run one$/m);
        ctx.expect(outer, 'a run that pushed nothing costs the outer layer nothing').toMatch(/^after run two$/m);
        ctx.expect(outer, 'a run that popped its own costs the outer layer nothing').toMatch(/^after run three$/m);

        for (const file of [pushedPath, secondPath]) {
          const contents = fs.readFileSync(file, 'utf8');
          ctx.expect(contents).toMatch(/^run one$/m);
          ctx.expect(!contents.includes('after run one'), `${path.basename(file)} came off at the restore`).toBeTruthy();
        }
        ctx.expect(spy.chunks.stdout).toEqual(['run one\n', 'after run one\n', 'after run two\n', 'after run three\n']);
      },
    },

    {
      name: 'detach restores the exact prior writers',
      run: (ctx) => {
        const logPath = scratchFile('restore.log');
        const spy = spyWriters();
        try {
          const tee = attachLogFile.createTee();
          const detach = tee.attach(logPath, NO_CI);
          ctx.expect(process.stdout.write, 'attach must patch stdout').not.toBe(spy.stdoutSpy);
          ctx.expect(process.stderr.write, 'attach must patch stderr').not.toBe(spy.stderrSpy);

          detach();
          ctx.expect(process.stdout.write).toBe(spy.stdoutSpy);
          ctx.expect(process.stderr.write).toBe(spy.stderrSpy);

          // Detaching twice is harmless and does not re-restore a stale writer.
          detach();
          ctx.expect(process.stdout.write).toBe(spy.stdoutSpy);
        } finally {
          spy.restore();
          fs.rmSync(logPath, { force: true });
        }
      },
    },

    {
      name: 'idempotent: attaching the same path twice does not double-write lines',
      run: (ctx) => {
        const logPath = scratchFile('idempotent.log');
        ctx.after(() => fs.rmSync(logPath, { force: true }));

        const spy = spyWriters();
        const tee = attachLogFile.createTee();
        let detach;
        try {
          detach = tee.attach(logPath, NO_CI);
          const again = tee.attach(logPath, NO_CI);
          ctx.expect(again, 'the second attach returns the live detach').toBe(detach);
          process.stdout.write('only once\n');
        } finally {
          if (detach) { detach(); }
          spy.restore();
        }

        const occurrences = fs.readFileSync(logPath, 'utf8').split('only once').length - 1;
        ctx.expect(occurrences).toBe(1);
      },
    },

    {
      name: 'CI: attach is a no-op that returns a no-op detach',
      run: (ctx) => {
        const logPath = scratchFile('ci.log');
        fs.rmSync(logPath, { force: true });

        const spy = spyWriters();
        try {
          for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
            const tee = attachLogFile.createTee();
            const detach = tee.attach(logPath, { env });
            ctx.expect(typeof detach).toBe('function');
            ctx.expect(process.stdout.write, 'CI must leave stdout alone').toBe(spy.stdoutSpy);
            ctx.expect(process.stderr.write, 'CI must leave stderr alone').toBe(spy.stderrSpy);
            detach();
            ctx.expect(process.stdout.write).toBe(spy.stdoutSpy);
          }
        } finally {
          spy.restore();
        }

        ctx.expect(fs.existsSync(logPath), 'CI must not create a log file').toBe(false);
      },
    },

    {
      name: 'attachInCI: a sink that OWNS its file still attaches on a runner',
      run: (ctx) => {
        // The signing box's `<runner home>/logs/runner.log` is the box's own record,
        // not a workspace artifact: the job it runs inside is exactly when it matters.
        const logPath = scratchFile('attach-in-ci.log');
        fs.rmSync(logPath, { force: true });

        const spy = spyWriters();
        let detach;
        try {
          const tee = attachLogFile.createTee();
          detach = tee.attach(logPath, { env: { GITHUB_ACTIONS: 'true' }, attachInCI: true });
          ctx.expect(process.stdout.write, 'the writers are patched despite CI').not.toBe(spy.stdoutSpy);
          process.stdout.write('signed on the box\n');
        } finally {
          if (detach) { detach(); }
          spy.restore();
        }

        ctx.expect(fs.readFileSync(logPath, 'utf8')).toMatch(/signed on the box/);
      },
    },

    {
      name: 'append: two sequential attaches to one file keep both runs',
      run: (ctx) => {
        // The box's runner.log is written by more than one process — a `runner start`
        // parent, then every `sign-windows` the listener spawns — so the second one
        // must not truncate the first's trail. Default is still truncate-on-open.
        const logPath = scratchFile('append.log');
        fs.rmSync(logPath, { force: true });

        const spy = spyWriters();
        try {
          for (const line of ['first run\n', 'second run\n']) {
            const detach = attachLogFile.createTee().attach(logPath, { env: {}, append: true });
            process.stdout.write(line);
            detach();
          }
        } finally {
          spy.restore();
        }

        const written = fs.readFileSync(logPath, 'utf8');
        ctx.expect(written).toMatch(/first run/);
        ctx.expect(written).toMatch(/second run/);
        ctx.expect(written.split('# omega log').length - 1, 'each run stamps its own header').toBe(2);

        // Unchanged by default: the next attach without the option truncates.
        const spy2 = spyWriters();
        try {
          const detach = attachLogFile.createTee().attach(logPath, NO_CI);
          process.stdout.write('third run\n');
          detach();
        } finally {
          spy2.restore();
        }
        const fresh = fs.readFileSync(logPath, 'utf8');
        ctx.expect(fresh.includes('first run'), 'the default still opens truncated').toBe(false);
        ctx.expect(fresh).toMatch(/third run/);
      },
    },

    {
      name: 'a falsy path is a no-op that returns a no-op detach',
      run: (ctx) => {
        const spy = spyWriters();
        try {
          const tee = attachLogFile.createTee();
          for (const value of [null, '', undefined]) {
            const detach = tee.attach(value, NO_CI);
            ctx.expect(typeof detach).toBe('function');
            ctx.expect(process.stdout.write).toBe(spy.stdoutSpy);
            detach();
          }
        } finally {
          spy.restore();
        }
      },
    },

    {
      name: 'an unopenable log path warns once and proceeds without a tee',
      run: (ctx) => {
        // Parent is a FILE, so both mkdir and open fail (ENOTDIR) without needing a
        // permissions dance that root would sail through.
        const blocker = scratchFile('blocker');
        fs.writeFileSync(blocker, 'not a directory\n');
        ctx.after(() => fs.rmSync(blocker, { force: true }));
        const logPath = path.join(blocker, 'impossible.log');

        const spy = spyWriters();
        let first;
        let second;
        try {
          const tee = attachLogFile.createTee();
          first = tee.attach(logPath, NO_CI);
          ctx.expect(process.stdout.write, 'a failed attach must not patch stdout').toBe(spy.stdoutSpy);
          second = tee.attach(logPath, NO_CI);
          // The process it observes keeps running.
          process.stdout.write('still alive\n');
        } finally {
          spy.restore();
        }

        ctx.expect(typeof first).toBe('function');
        ctx.expect(typeof second).toBe('function');
        ctx.expect(spy.chunks.stdout).toEqual(['still alive\n']);

        const warnings = spy.chunks.stderr.map((chunk) => attachLogFile.stripAnsi(chunk)).join('');
        ctx.expect(warnings).toMatch(/\[@omega\.js\/devkit:attach-log-file\]/);
        ctx.expect(warnings).toMatch(/impossible\.log/);
        ctx.expect(warnings.split('@omega.js/devkit:attach-log-file').length - 1, 'warns once, not per attempt').toBe(1);
      },
    },

    {
      name: 'crash tail: the last lines before a fatal throw land in the file',
      run: (ctx) => {
        const logPath = scratchFile('crash.log');
        const scriptPath = scratchFile('crash-child.js');
        ctx.after(() => {
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
        ctx.expect(child.status, 'the child must actually die').not.toBe(0);

        const contents = fs.readFileSync(logPath, 'utf8');
        ctx.expect(contents).toMatch(/^first line$/m);
        // The line written in the same tick as the throw: a buffered stream loses this one.
        ctx.expect(contents).toMatch(/^the last line before the crash$/m);

        // Node dumps a fatal exception straight to fd 2, below any userland write patch, so the
        // stack reaches the terminal but never the tee. Pinned so it reads as known, not broken.
        ctx.expect(child.stderr).toMatch(/Error: boom/);
        ctx.expect(!contents.includes('Error: boom')).toBeTruthy();
      },
    },

    {
      name: 'child log: writes land ANSI-stripped in a file that opened truncated',
      run: (ctx) => {
        const logPath = scratchFile('child.log');
        ctx.after(() => fs.rmSync(logPath, { force: true }));
        fs.writeFileSync(logPath, 'STALE LINE FROM THE PREVIOUS RUN\n');

        const childLog = attachLogFile.createChildLog({ logPath });
        childLog.write(Buffer.from('\x1B[32mchild says hi\x1B[0m\n'));
        childLog.close();

        const contents = fs.readFileSync(logPath, 'utf8');
        ctx.expect(!contents.includes('STALE LINE'), 'the previous run must be cleared').toBeTruthy();
        ctx.expect(contents).toMatch(/^child says hi$/m);
        ctx.expect(!contents.includes('\x1B['), 'the file must be ANSI-free').toBeTruthy();
      },
    },

    {
      name: 'child log: a touched reset sentinel rolls the log mid-run and is consumed',
      run: async (ctx) => {
        const logPath = scratchFile('child-roll.log');
        const resetPath = scratchFile('child-roll.log.reset');
        ctx.after(() => {
          fs.rmSync(logPath, { force: true });
          fs.rmSync(resetPath, { force: true });
        });

        const childLog = attachLogFile.createChildLog({ logPath, resetPath, pollMs: 25 });
        try {
          childLog.write('before the reset\n');

          // Another process asking this long-lived log for a fresh start.
          fs.writeFileSync(resetPath, '');
          ctx.expect(await until(() => !fs.existsSync(resetPath)), 'the sentinel must be consumed').toBeTruthy();

          childLog.write('after the reset\n');
          ctx.expect(await until(() => fs.readFileSync(logPath, 'utf8').includes('after the reset'))).toBeTruthy();
        } finally {
          childLog.close();
        }

        const contents = fs.readFileSync(logPath, 'utf8');
        ctx.expect(!contents.includes('before the reset'), 'the roll must clear the pre-reset run').toBeTruthy();
        ctx.expect(contents).toMatch(/^after the reset$/m);
      },
    },

    {
      name: 'child log: a sentinel left by a crashed run never rolls the fresh log',
      run: async (ctx) => {
        const logPath = scratchFile('child-stale.log');
        const resetPath = scratchFile('child-stale.log.reset');
        ctx.after(() => {
          fs.rmSync(logPath, { force: true });
          fs.rmSync(resetPath, { force: true });
        });
        fs.writeFileSync(resetPath, '');

        const childLog = attachLogFile.createChildLog({ logPath, resetPath, pollMs: 25 });
        try {
          childLog.write('this run keeps its output\n');
          // Long enough for several polls of a sentinel that must already be gone.
          await new Promise((resolve) => setTimeout(resolve, 150));
          ctx.expect(await until(() => fs.readFileSync(logPath, 'utf8').includes('this run keeps its output'))).toBeTruthy();
        } finally {
          childLog.close();
        }

        ctx.expect(fs.existsSync(resetPath), 'close() leaves no sentinel behind').toBe(false);
      },
    },

    {
      name: 'child log: an unopenable path warns once and drops the rest in silence',
      run: (ctx) => {
        // Parent is a FILE, so both mkdir and open fail (ENOTDIR) — same trick the
        // tee's unopenable case uses, no permissions dance.
        const blocker = scratchFile('child-blocker');
        fs.writeFileSync(blocker, 'not a directory\n');
        ctx.after(() => fs.rmSync(blocker, { force: true }));
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

        ctx.expect(spy.chunks.stdout, 'a dropped write never reaches the terminal twice').toEqual(['still alive\n']);

        const warnings = spy.chunks.stderr.map((chunk) => attachLogFile.stripAnsi(chunk)).join('');
        ctx.expect(warnings).toMatch(/\[@omega\.js\/devkit:attach-log-file\]/);
        ctx.expect(warnings).toMatch(/impossible\.log/);
        ctx.expect(warnings.split('@omega.js/devkit:attach-log-file').length - 1, 'warns once, not per chunk').toBe(1);
      },
    },

    {
      name: 'child log: writes after close() stay silent — a closed sink is not a broken one',
      run: (ctx) => {
        const logPath = scratchFile('child-closed.log');
        ctx.after(() => fs.rmSync(logPath, { force: true }));

        const spy = spyWriters();
        try {
          const childLog = attachLogFile.createChildLog({ logPath });
          childLog.close();
          childLog.write('a chunk that arrived after teardown\n');
        } finally {
          spy.restore();
        }

        ctx.expect(spy.chunks.stderr, 'no warning for a log that opened fine and was closed').toEqual([]);
      },
    },
  ],
});

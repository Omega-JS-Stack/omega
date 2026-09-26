// Build-layer tests for the boot runner's budget
// ([#907](https://github.com/Omega-JS-Stack/omega/issues/907)).
//
// A boot that blocks inside initialize() never reaches the harness, so the per-test
// timeout in harness/boot-entry.js cannot fire and the spawn (which only resolved on
// exit) hung `npx omega test` forever. The child is INJECTED here, so both verdicts
// are provable without booting Electron: a child that never exits, and one that exits
// the way a healthy run does.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { EventEmitter } = require('events');
const jetpack = require('fs-jetpack');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { runBootChild } = require(path.join(__dirname, '..', '..', 'runners', 'boot.js'));
const { TEST_EVENT_PREFIX } = require(path.join(__dirname, '..', '..', '..', 'utils', 'test-events.js'));

// A project root the runner reads its report clue from. `logLine` null writes no
// logs/ at all, the boot that died before the logger ever opened a file.
function seedRoot(logLine) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-boot-budget-')));
  if (logLine !== null) {
    // A trailing blank line is what a log file actually ends with.
    jetpack.write(path.join(root, 'logs', 'runtime.log'), `first line\n${logLine}\n\n`);
  }
  return root;
}

// The spawn seam's child: the surface runBootChild touches, and a record of every
// signal it was sent.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => { child.signals.push(signal || 'SIGTERM'); return true; };
  return child;
}

// The runner reports on console.log; collect it instead of printing it into THIS run.
async function capture(lines, fn) {
  const realLog = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    return await fn();
  } finally {
    console.log = realLog;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'boot runner budget: a boot with no harness output fails with a report instead of hanging',
  tests: [
    {
      name: 'the budget fires: the report quotes the last runtime.log line, every boot test counts failed, the child is ended',
      run: async (ctx) => {
        const root = seedRoot('[@omega.js/desktop:startup] isLaunchHidden: true');
        const specFile = path.join(root, 'spec.json');
        jetpack.write(specFile, '{}');
        const child = fakeChild();
        const lines = [];
        const started = Date.now();

        const counts = await capture(lines, () => runBootChild({
          electronBin:   '/not/spawned/electron',
          args:          [root],
          childEnv:      {},
          effectiveRoot: root,
          specFile,
          skipEvents:    [],
          testCount:     3,
          spawnFn:       () => child,
          timeoutMs:     1000,
          killGraceMs:   20,
        }));

        // Resolved on its own timer, not at the child's leisure.
        ctx.expect(Date.now() - started).toBeLessThan(5000);
        ctx.expect(counts).toEqual({ passed: 0, failed: 3, skipped: 0 });

        const report = lines.join('\n');
        ctx.expect(report).toMatch(/✗ boot: no harness output after 1s/);
        ctx.expect(report).toMatch(/last runtime\.log line: "\[@omega\.js\/desktop:startup\] isLaunchHidden: true"/);

        // The child is ended, and escalated when the grace passes without it going.
        ctx.expect(child.signals).toEqual(['SIGTERM']);
        await sleep(60);
        ctx.expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);

        ctx.expect(fs.existsSync(specFile)).toBe(false);
        jetpack.remove(root);
      },
    },
    {
      name: 'a missing runtime.log is reported as such, not a crash',
      run: async (ctx) => {
        const root = seedRoot(null);
        const specFile = path.join(root, 'spec.json');
        jetpack.write(specFile, '{}');
        const child = fakeChild();
        const lines = [];

        const counts = await capture(lines, () => runBootChild({
          electronBin:   '/not/spawned/electron',
          args:          [root],
          childEnv:      {},
          effectiveRoot: root,
          specFile,
          skipEvents:    [],
          testCount:     1,
          spawnFn:       () => child,
          timeoutMs:     20,
          killGraceMs:   20,
        }));

        ctx.expect(counts.failed).toBe(1);
        ctx.expect(lines.join('\n')).toMatch(/last runtime\.log line: "\(no runtime\.log\)"/);
        jetpack.remove(root);
      },
    },
    {
      // The budget is IDLE time, never total run time: a boot suite that
      // legitimately runs longer than the budget keeps going as long as it
      // keeps talking, and only SILENCE for a whole budget fails the run.
      name: 'harness output REARMS the budget, so a run past it is never killed',
      run: async (ctx) => {
        const root = seedRoot('[@omega.js/desktop:startup] isLaunchHidden: true');
        const specFile = path.join(root, 'spec.json');
        jetpack.write(specFile, '{}');
        const child = fakeChild();
        const lines = [];
        const started = Date.now();

        const counts = await capture(lines, async () => {
          const pending = runBootChild({
            electronBin:   '/not/spawned/electron',
            args:          [root],
            childEnv:      {},
            effectiveRoot: root,
            specFile,
            skipEvents:    [],
            testCount:     2,
            spawnFn:       () => child,
            timeoutMs:     400,
            killGraceMs:   20,
          });

          child.stdout.emit('data', `${TEST_EVENT_PREFIX}${JSON.stringify({ event: 'result', name: 'the app boots', passed: true, duration: 12 })}\n`);
          await sleep(150);
          child.stdout.emit('data', `${TEST_EVENT_PREFIX}${JSON.stringify({ event: 'result', name: 'a slow suite finishes', passed: true, duration: 12 })}\n`);
          await sleep(150);
          child.stdout.emit('data', `${TEST_EVENT_PREFIX}${JSON.stringify({ event: 'result', name: 'and another', passed: true, duration: 12 })}\n`);
          await sleep(150);
          child.emit('exit', 0);

          return pending;
        });

        ctx.expect(Date.now() - started).toBeGreaterThan(400);
        ctx.expect(counts).toEqual({ passed: 3, failed: 0, skipped: 0 });
        ctx.expect(child.signals).toEqual([]);
        ctx.expect(lines.join('\n').includes('no harness output')).toBe(false);
        jetpack.remove(root);
      },
    },
    {
      // The timeout hands its counts to the caller, so a line arriving while
      // the child is being killed must reach nothing at all: the report is
      // already printed and the numbers already reported.
      name: 'a line landing AFTER the timeout report changes nothing',
      run: async (ctx) => {
        const root = seedRoot('[@omega.js/desktop:startup] isLaunchHidden: true');
        const specFile = path.join(root, 'spec.json');
        jetpack.write(specFile, '{}');
        const child = fakeChild();
        const lines = [];

        const counts = await capture(lines, async () => {
          const settled = await runBootChild({
            electronBin:   '/not/spawned/electron',
            args:          [root],
            childEnv:      {},
            effectiveRoot: root,
            specFile,
            skipEvents:    [],
            testCount:     2,
            spawnFn:       () => child,
            timeoutMs:     30,
            killGraceMs:   20,
          });

          child.stdout.emit('data', `${TEST_EVENT_PREFIX}${JSON.stringify({ event: 'result', name: 'a late line', passed: true, duration: 12 })}\n`);
          child.emit('exit', 0);
          await sleep(40);

          return settled;
        });

        ctx.expect(counts).toEqual({ passed: 0, failed: 2, skipped: 0 });
        ctx.expect(lines.join('\n').includes('a late line')).toBe(false);
        jetpack.remove(root);
      },
    },
    {
      name: 'a child that exits normally reports its results and clears the timer',
      run: async (ctx) => {
        const root = seedRoot('[@omega.js/desktop:startup] isLaunchHidden: true');
        const specFile = path.join(root, 'spec.json');
        jetpack.write(specFile, '{}');
        const child = fakeChild();
        const lines = [];

        const counts = await capture(lines, async () => {
          const pending = runBootChild({
            electronBin:   '/not/spawned/electron',
            args:          [root],
            childEnv:      {},
            effectiveRoot: root,
            specFile,
            skipEvents:    [],
            testCount:     1,
            spawnFn:       () => child,
            timeoutMs:     50,
            killGraceMs:   20,
          });

          child.stdout.emit('data', `${TEST_EVENT_PREFIX}${JSON.stringify({ event: 'result', name: 'the app boots', passed: true, duration: 12 })}\n`);
          child.emit('exit', 0);

          const settled = await pending;
          // Past the budget: a timer the exit did not clear would report here.
          await sleep(120);
          return settled;
        });

        ctx.expect(counts).toEqual({ passed: 1, failed: 0, skipped: 0 });
        ctx.expect(child.signals).toEqual([]);

        const report = lines.join('\n');
        ctx.expect(report).toMatch(/✓ the app boots/);
        ctx.expect(report.includes('no harness output')).toBe(false);
        jetpack.remove(root);
      },
    },
  ],
});

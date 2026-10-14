// Build-layer tests for the boot driver's idle budget. A boot that blocks inside
// initialize() never reaches the harness, so the child is INJECTED here: both
// verdicts are provable without booting Electron. Each case event arrives through
// `report`, and a harness line is the one envelope: `__OMEGA_TEST__` + the event.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { EventEmitter } = require('events');
const jetpack = require('fs-jetpack');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { EVENT_PREFIX } = require('@omega.js/devkit/test/events');

const { runBootChild } = require(path.join(__dirname, '..', '..', 'runners', 'boot.js'));

const FILE = 'boot/budget.test.js';

// A project root the driver reads its report clue from. `logLine` null writes no
// logs/ at all, the boot that died before the logger ever opened a file.
function seedRoot(logLine) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-boot-budget-')));
  if (logLine !== null) {
    // A trailing blank line is what a log file actually ends with.
    jetpack.write(path.join(root, 'logs', 'runtime.log'), `first line\n${logLine}\n\n`);
  }
  return root;
}

// The spawn seam's child: the surface runBootChild touches, a record of every
// signal it was sent, and `end(code)` emitting `exit` then `close` as a real child does.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => { child.signals.push(signal || 'SIGTERM'); return true; };
  child.end = (code) => { child.emit('exit', code, null); child.emit('close', code, null); };
  return child;
}

// `count` normalized-looking cases of one boot suite, ids `<file>#<index>`.
function casesOf(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `${FILE}#${index}`, name: `boot case ${index + 1}` }));
}

// One harness line carrying a passing case event.
function passLine(caseDef) {
  return `${EVENT_PREFIX}${JSON.stringify({ id: caseDef.id, name: caseDef.name, status: 'pass', durationMs: 12 })}\n`;
}

// The driver may print its verdict too; silence it so it never lands in THIS run.
async function quiet(fn) {
  const realLog = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = realLog;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// The runBootChild options every case shares; `overrides` carries the per-case knobs.
function childOptions(root, specFile, child, cases, events, overrides) {
  return {
    electronBin:   '/not/spawned/electron',
    entry:         root,
    childEnv:      {},
    effectiveRoot: root,
    specFile,
    cases,
    report:        (event) => { events.push(event); },
    spawnFn:       () => child,
    killGraceMs:   20,
    ...overrides,
  };
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'boot driver budget: a boot with no harness output fails with a report instead of hanging',
  tests: [
    {
      name: 'case-161 the budget fires: every boot case reports failed quoting the last runtime.log line, and the child is ended',
      run: async (ctx) => {
        const root = seedRoot('[@omega.js/desktop:startup] isLaunchHidden: true');
        const specFile = path.join(root, 'spec.json');
        jetpack.write(specFile, '{}');
        const child = fakeChild();
        const cases = casesOf(3);
        const events = [];
        const started = Date.now();

        await quiet(() => runBootChild(childOptions(root, specFile, child, cases, events, { timeoutMs: 1000 })));

        // Resolved on its own timer, not at the child's leisure.
        ctx.expect(Date.now() - started).toBeLessThan(5000);
        ctx.expect(events.map((event) => [event.id, event.status])).toEqual(cases.map((caseDef) => [caseDef.id, 'fail']));
        for (const event of events) {
          ctx.expect(event.error.message).toMatch(/no harness output after 1s/);
          ctx.expect(event.error.message).toMatch(/last runtime\.log line: "\[@omega\.js\/desktop:startup\] isLaunchHidden: true"/);
        }

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
        const events = [];

        await quiet(() => runBootChild(childOptions(root, specFile, child, casesOf(1), events, { timeoutMs: 20 })));

        ctx.expect(events.length).toBe(1);
        ctx.expect(events[0].status).toBe('fail');
        ctx.expect(events[0].error.message).toMatch(/last runtime\.log line: "\(no runtime\.log\)"/);
        jetpack.remove(root);
      },
    },
    {
      // The budget is IDLE time, never total run time: a boot suite that keeps
      // talking keeps going, and only SILENCE for a whole budget fails the run.
      name: 'harness output REARMS the budget, so a run past it is never killed',
      run: async (ctx) => {
        const root = seedRoot('[@omega.js/desktop:startup] isLaunchHidden: true');
        const specFile = path.join(root, 'spec.json');
        jetpack.write(specFile, '{}');
        const child = fakeChild();
        const cases = casesOf(3);
        const events = [];
        const started = Date.now();

        await quiet(async () => {
          const pending = runBootChild(childOptions(root, specFile, child, cases, events, { timeoutMs: 400 }));

          for (const caseDef of cases) {
            child.stdout.emit('data', passLine(caseDef));
            await sleep(150);
          }
          child.end(0);

          return pending;
        });

        ctx.expect(Date.now() - started).toBeGreaterThan(400);
        ctx.expect(events.map((event) => [event.id, event.status])).toEqual(cases.map((caseDef) => [caseDef.id, 'pass']));
        ctx.expect(child.signals).toEqual([]);
        jetpack.remove(root);
      },
    },
    {
      // The timeout has settled every case, so a line arriving while the child
      // is being killed must reach nothing at all.
      name: 'a line landing AFTER the timeout report changes nothing',
      run: async (ctx) => {
        const root = seedRoot('[@omega.js/desktop:startup] isLaunchHidden: true');
        const specFile = path.join(root, 'spec.json');
        jetpack.write(specFile, '{}');
        const child = fakeChild();
        const cases = casesOf(2);
        const events = [];

        await quiet(async () => {
          await runBootChild(childOptions(root, specFile, child, cases, events, { timeoutMs: 30 }));

          child.stdout.emit('data', passLine(cases[0]));
          child.end(0);
          await sleep(40);
        });

        ctx.expect(events.map((event) => [event.id, event.status])).toEqual(cases.map((caseDef) => [caseDef.id, 'fail']));
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
        const cases = casesOf(1);
        const events = [];

        await quiet(async () => {
          const pending = runBootChild(childOptions(root, specFile, child, cases, events, { timeoutMs: 50 }));

          child.stdout.emit('data', passLine(cases[0]));
          child.end(0);

          await pending;
          // Past the budget: a timer the exit did not clear would report here.
          await sleep(120);
        });

        ctx.expect(events.map((event) => [event.id, event.status])).toEqual([[cases[0].id, 'pass']]);
        ctx.expect(child.signals).toEqual([]);
        jetpack.remove(root);
      },
    },
  ],
});

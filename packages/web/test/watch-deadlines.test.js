/**
 * The rebuild deadlines every watch suite reads (the 30s solo floor and the lane
 * multiplier), and that the suites in test/watch/ run alone, in the runner's serial lane.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { BASE_REBUILD_DEADLINE_MS, SCALE_VAR, caseTimeoutMs, deadlineScale, rebuildDeadlineMs } = require('./lib/deadlines.js');

// An idle machine: the knob's assertions are about the knob, so the OTHER
// measurement is pinned (#615).
const IDLE = { load: 1, cpus: 10 };

// The DIRECTORY is the list — a suite is serialized by living there, so a new
// watcher suite cannot be added to one lane and forgotten by the other.
const WATCH_DIR = path.join(__dirname, 'watch');
const WATCHERS = fs.readdirSync(WATCH_DIR).filter((file) => file.endsWith('.test.js'));

module.exports = defineCases({
  type: 'group',
  description: 'watch-deadlines',
  tests: [
    {
      name: '#211: the scale defaults to 1 — a solo run keeps the tight deadline',
      run: (ctx) => {
        ctx.expect(deadlineScale({}), 'unset means solo').toBe(1);
        ctx.expect(deadlineScale({ OMEGA_TEST_DEADLINE_SCALE: '' }), 'an empty value is unset').toBe(1);
        ctx.expect(rebuildDeadlineMs({ ...IDLE, env: {} })).toBe(BASE_REBUILD_DEADLINE_MS);
        ctx.expect(BASE_REBUILD_DEADLINE_MS, 'the solo deadline is unchanged').toBe(30000);
      },
    },

    {
      name: '#211: the lane multiplier scales every watch deadline',
      run: (ctx) => {
        ctx.expect(deadlineScale({ OMEGA_TEST_DEADLINE_SCALE: '3' })).toBe(3);
        ctx.expect(rebuildDeadlineMs({ ...IDLE, env: { OMEGA_TEST_DEADLINE_SCALE: '3' } }), 'the full-suite deadline').toBe(90000);
        ctx.expect(rebuildDeadlineMs({ ...IDLE, env: { OMEGA_TEST_DEADLINE_SCALE: '1.5' } }), 'fractional scales are honoured').toBe(45000);
      },
    },

    {
      name: '#211: a junk multiplier fails loudly instead of silently running unscaled',
      run: (ctx) => {
        for (const value of ['later', '0', '-2', 'NaN']) {
          ctx.expect(() => deadlineScale({ OMEGA_TEST_DEADLINE_SCALE: value }), `"${value}" is not a multiplier`).toThrow(/OMEGA_TEST_DEADLINE_SCALE/);
        }
      },
    },

    {
      name: '#211: every watch-deadline suite reads the knob — no file keeps its own constant',
      run: (ctx) => {
        ctx.expect(WATCHERS.length >= 3, 'the watcher lane still holds the rebuild-polling suites').toBeTruthy();

        for (const file of WATCHERS) {
          const source = fs.readFileSync(path.join(WATCH_DIR, file), 'utf8');
          ctx.expect(source.includes("require('../lib/deadlines.js')"), `${file} reads the shared deadline`).toBeTruthy();
          ctx.expect(!/REBUILD_DEADLINE_MS\s*=\s*\d/.test(source), `${file} declares no deadline of its own`).toBeTruthy();
        }
      },
    },

    {
      name: 'every watch suite times its cases out at caseTimeoutMs, past the ceiling of its sequential waits',
      run: (ctx) => {
        ctx.expect(caseTimeoutMs({ env: {} }), 'solo: 30s floor x 6 load factor x 3 waits').toBe(540000);
        ctx.expect(caseTimeoutMs({ env: { OMEGA_TEST_DEADLINE_SCALE: '3' } }), 'the root lane triples it').toBe(1620000);

        // rebuild-deadline clears the lane knob as it loads, so every load here reads it cleared.
        const saved = process.env[SCALE_VAR];
        delete process.env[SCALE_VAR];
        ctx.after(() => { if (saved !== undefined) process.env[SCALE_VAR] = saved; });

        for (const file of WATCHERS) {
          const spec = require(path.join(WATCH_DIR, file));
          ctx.expect(spec.timeout, `${file} declares its suite timeout`).toBe(caseTimeoutMs());
        }
      },
    },

    {
      name: '#344: the rebuild-polling suites run alone, in the runner\'s serial lane, each in its own process',
      run: (ctx) => {
        const { runnerConfig } = require('../src/commands/test.js');
        const config = runnerConfig({ projectRoot: path.join(__dirname, '..'), selfTest: true });

        // A watcher suite run beside other files is the flake back: sibling
        // processes churning temp trees is what starves its FSEvents stream.
        ctx.expect(config.serial, 'test/watch/ runs after every other file, one file at a time').toEqual(['watch']);
        ctx.expect(config.isolation, 'each file runs in its own child').toBe('process');
      },
    },
  ],
});

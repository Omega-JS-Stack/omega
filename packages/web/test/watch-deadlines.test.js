/**
 * #211 — the watch-deadline knob, #344 — the watcher suites' own lane, and
 * #615 — the contention the knob cannot see.
 *
 * The rebuild-watching suites poll a built page until it changes, with a
 * deadline. 30s is generous for a solo run and marginal under the full
 * parallel suite. The deadlines read a MULTIPLIER the root lane runner sets
 * (scripts/lane.js), so a lane run gets 90s while a solo `node --test` keeps
 * the tight 30s that surfaces a real regression fast.
 *
 * A bigger deadline was never the whole answer (#344): the lane failures are
 * not slow rebuilds. Nine sightings later, an instrumented capture showed the
 * packaged-layer watcher receiving zero chokidar events — not one raw event —
 * for 91 seconds, while `getWatched()` still listed the edited file. It
 * correlates with load, so these suites now live in `test/watch/` and run in
 * their OWN serial phase, after the parallel one (packages/web package.json).
 * Serializing them was rejected once for costing wall time (triage,
 * 2026-08-14); the cost is ~20s and the alternative was a flake that twice
 * blocked a ship gate. The doubled-reset half of #344 is fixed in the suite
 * that owns it (dev-server-restart, event-keyed instead of count-keyed).
 *
 * The knob only reaches a run the LANE started, and the sightings that reopened
 * this (#615) were bare `npm test -w packages/web` runs beside other work. So
 * the deadline reads the machine too: the 30s floor times measured contention
 * (load average per CPU), times this knob. The derivation and its failure
 * message live in test/watch/rebuild-deadline.test.js; what this file holds is
 * the knob's own contract and the lane's shape.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { BASE_REBUILD_DEADLINE_MS, deadlineScale, rebuildDeadlineMs } = require('./lib/deadlines.js');

// An idle machine: the knob's assertions are about the knob, so the OTHER
// measurement is pinned (#615).
const IDLE = { load: 1, cpus: 10 };

// The DIRECTORY is the list — a suite is serialized by living there, so a new
// watcher suite cannot be added to one lane and forgotten by the other.
const WATCH_DIR = path.join(__dirname, 'watch');
const WATCHERS = fs.readdirSync(WATCH_DIR).filter((file) => file.endsWith('.test.js'));

test('#211: the scale defaults to 1 — a solo run keeps the tight deadline', () => {
  assert.strictEqual(deadlineScale({}), 1, 'unset means solo');
  assert.strictEqual(deadlineScale({ OMEGA_TEST_DEADLINE_SCALE: '' }), 1, 'an empty value is unset');
  assert.strictEqual(rebuildDeadlineMs({ ...IDLE, env: {} }), BASE_REBUILD_DEADLINE_MS);
  assert.strictEqual(BASE_REBUILD_DEADLINE_MS, 30000, 'the solo deadline is unchanged');
});

test('#211: the lane multiplier scales every watch deadline', () => {
  assert.strictEqual(deadlineScale({ OMEGA_TEST_DEADLINE_SCALE: '3' }), 3);
  assert.strictEqual(rebuildDeadlineMs({ ...IDLE, env: { OMEGA_TEST_DEADLINE_SCALE: '3' } }), 90000, 'the full-suite deadline');
  assert.strictEqual(rebuildDeadlineMs({ ...IDLE, env: { OMEGA_TEST_DEADLINE_SCALE: '1.5' } }), 45000, 'fractional scales are honoured');
});

test('#211: a junk multiplier fails loudly instead of silently running unscaled', () => {
  for (const value of ['later', '0', '-2', 'NaN']) {
    assert.throws(
      () => deadlineScale({ OMEGA_TEST_DEADLINE_SCALE: value }),
      /OMEGA_TEST_DEADLINE_SCALE/,
      `"${value}" is not a multiplier`,
    );
  }
});

test('#211: every watch-deadline suite reads the knob — no file keeps its own constant', () => {
  assert.ok(WATCHERS.length >= 3, 'the watcher lane still holds the rebuild-polling suites');

  for (const file of WATCHERS) {
    const source = fs.readFileSync(path.join(WATCH_DIR, file), 'utf8');
    assert.ok(source.includes("require('../lib/deadlines.js')"), `${file} reads the shared deadline`);
    assert.ok(!/REBUILD_DEADLINE_MS\s*=\s*\d/.test(source), `${file} declares no deadline of its own`);
  }
});

test('#344: the rebuild-polling suites run in their own serial lane', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).scripts;

  // A watcher suite left in the parallel glob is the flake back: nine sibling
  // processes churning temp trees is what starves its FSEvents stream.
  assert.match(scripts.test, /--test-concurrency=1 test\/watch\/\*\.test\.js/,
    'test/watch/ runs one file at a time, in its own phase');
  assert.doesNotMatch(scripts.test, /test\/\*\*\/\*\.test\.js/,
    'the parallel phase globs one level only — test/watch/ may never be swept into it');
});

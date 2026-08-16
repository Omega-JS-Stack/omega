/**
 * #211 — the watch-deadline knob.
 *
 * The rebuild-watching suites (dev-watch, live-decisions, dev-server-restart)
 * poll a built page until it changes, with a deadline. 30s is generous for a
 * solo run and marginal under the full parallel suite, where eight sightings
 * of the same class have blown a deadline that passed standalone minutes
 * later. The deadlines now read a MULTIPLIER the root lane runner sets
 * (scripts/lane.js), so a lane run gets 90s while a solo `node --test` keeps
 * the tight 30s that surfaces a real regression fast. Serializing the tests
 * was the rejected alternative — it slows every full run (triage, 2026-08-14).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { BASE_REBUILD_DEADLINE_MS, deadlineScale, rebuildDeadlineMs } = require('./lib/deadlines.js');

const WATCHERS = ['dev-watch.test.js', 'live-decisions.test.js', 'dev-server-restart.test.js'];

test('#211: the scale defaults to 1 — a solo run keeps the tight deadline', () => {
  assert.strictEqual(deadlineScale({}), 1, 'unset means solo');
  assert.strictEqual(deadlineScale({ OMEGA_TEST_DEADLINE_SCALE: '' }), 1, 'an empty value is unset');
  assert.strictEqual(rebuildDeadlineMs({}), BASE_REBUILD_DEADLINE_MS);
  assert.strictEqual(BASE_REBUILD_DEADLINE_MS, 30000, 'the solo deadline is unchanged');
});

test('#211: the lane multiplier scales every watch deadline', () => {
  assert.strictEqual(deadlineScale({ OMEGA_TEST_DEADLINE_SCALE: '3' }), 3);
  assert.strictEqual(rebuildDeadlineMs({ OMEGA_TEST_DEADLINE_SCALE: '3' }), 90000, 'the full-suite deadline');
  assert.strictEqual(rebuildDeadlineMs({ OMEGA_TEST_DEADLINE_SCALE: '1.5' }), 45000, 'fractional scales are honoured');
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
  for (const file of WATCHERS) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(source.includes("require('./lib/deadlines.js')"), `${file} reads the shared deadline`);
    assert.ok(!/REBUILD_DEADLINE_MS\s*=\s*\d/.test(source), `${file} declares no deadline of its own`);
  }
});

/**
 * The shared wall-clock formatter behind the manage walk's per-service lines
 * and the run summary's total.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { formatDuration } = require('../src/lib/duration.js');

test('formatDuration: sub-second stays in milliseconds', () => {
  assert.equal(formatDuration(0), '0ms');
  assert.equal(formatDuration(340), '340ms');
  assert.equal(formatDuration(999.4), '999ms');
});

test('formatDuration: seconds, minutes, hours', () => {
  assert.equal(formatDuration(1000), '1s');
  assert.equal(formatDuration(14_200), '14s');
  assert.equal(formatDuration(94_000), '1m 34s');
  assert.equal(formatDuration(3_600_000), '1h 0m 0s');
  assert.equal(formatDuration(3_723_000), '1h 2m 3s');
});

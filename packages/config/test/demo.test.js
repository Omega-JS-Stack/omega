/**
 * demo.js — the shared demo-project test. Firebase's own convention:
 * `demo-*` project ids are emulator-only, and every cloud-touching service
 * short-circuits on them, so the truth table is a wire-visible contract.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isDemoProject } = require('../src/index.js');

test('demo-* project ids are demo projects', () => {
  assert.strictEqual(isDemoProject('demo-omega'), true);
  assert.strictEqual(isDemoProject('demo-sandbox-brand'), true);
  // The bare prefix counts — Firebase accepts `demo-` as a valid emulator id.
  assert.strictEqual(isDemoProject('demo-'), true);
});

test('real project ids are not demo projects', () => {
  assert.strictEqual(isDemoProject('omegajs'), false);
  assert.strictEqual(isDemoProject('omegajs-playground'), false);
  // The prefix must LEAD — a mid-string match is a real project.
  assert.strictEqual(isDemoProject('my-demo-project'), false);
  // Case-sensitive: Firebase project ids are lowercase, so `Demo-` is real.
  assert.strictEqual(isDemoProject('Demo-omega'), false);
  assert.strictEqual(isDemoProject('demo'), false);
});

test('absent or non-string ids are not demo projects', () => {
  assert.strictEqual(isDemoProject(undefined), false);
  assert.strictEqual(isDemoProject(null), false);
  assert.strictEqual(isDemoProject(''), false);
  assert.strictEqual(isDemoProject(0), false);
  assert.strictEqual(isDemoProject({}), false);
});

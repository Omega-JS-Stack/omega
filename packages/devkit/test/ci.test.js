/**
 * isCI: the one answer to "is this a CI runner", read by every lane that acts
 * differently there. Real env objects, no process.env.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { isCI } = require('../src/ci.js');

test('GITHUB_ACTIONS=true or CI=true is a CI runner (#1027)', () => {
  assert.equal(isCI({ GITHUB_ACTIONS: 'true' }), true);
  assert.equal(isCI({ CI: 'true' }), true);
  assert.equal(isCI({ GITHUB_ACTIONS: 'true', CI: 'true' }), true);
});

test('neither variable is a local machine (#1027)', () => {
  assert.equal(isCI({}), false);
  assert.equal(isCI({ HOME: '/Users/dev', NODE_ENV: 'production' }), false);
});

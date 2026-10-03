const { test } = require('node:test');
const assert = require('node:assert/strict');

const cond = 'skip-reason-109';

test('a', { skip: cond, timeout: 5000 }, () => {
  assert.ok(true);
});

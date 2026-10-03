const { test } = require('node:test');
const assert = require('node:assert/strict');

test('plain', () => {
  assert.deepStrictEqual([1], [1]);
});

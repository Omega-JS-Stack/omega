const { test } = require('node:test');
const assert = require('node:assert');

test('bare', () => {
  const x = 1;
  assert(x, 'm');
});

test('loose', () => {
  const a = 1;
  const b = 1;
  assert.equal(a, b);
});

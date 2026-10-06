const { test } = require('node:test');
const assert = require('node:assert');

function check(x) {
  assert.ok(x);
}

test('helper and case', () => {
  const a = 1;
  const b = 1;
  check(a);
  assert.equal(a, b);
});

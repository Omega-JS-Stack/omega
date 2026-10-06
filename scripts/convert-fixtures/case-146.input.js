const { test } = require('node:test');
const assert = require('node:assert/strict');

function refuse(message) {
  throw new assert.AssertionError({ message });
}

test('a', () => {
  const ready = true;
  if (!ready) refuse('not ready');
  assert.ok(ready);
});

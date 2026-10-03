const { test } = require('node:test');
const assert = require('node:assert/strict');

test('a', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fired = false;
  setTimeout(() => {
    fired = true;
  }, 1000);
  t.mock.timers.tick(1000);
  assert.strictEqual(fired, true);
});

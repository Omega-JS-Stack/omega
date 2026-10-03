const { test } = require('node:test');
const assert = require('node:assert/strict');

const fn = () => {
  throw new Error('x');
};
const calm = () => {};

test('throws and rejects', async () => {
  const p = Promise.reject(new Error('re'));
  assert.throws(fn, /re/);
  assert.throws(fn, Error);
  assert.throws(fn, { message: 'x' });
  await assert.rejects(p, /re/);
  assert.doesNotThrow(calm);
});

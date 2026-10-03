const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('A', () => {
  describe('B', () => {
    it('c', () => {
      assert.strictEqual(1, 1);
    });
  });
});

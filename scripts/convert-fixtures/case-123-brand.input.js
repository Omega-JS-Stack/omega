const assert = require('node:assert/strict');
const { defineCases } = require('@omega.js/backend/test');

function same(a, b) {
  assert.equal(a, b);
}

module.exports = defineCases({
  description: 'case-123-brand bare require',
  type: 'group',
  tests: [
    {
      name: 'helper and case',
      async run({ state }) {
        state.seen = 1;
        const a = state.seen;
        const b = 1;
        same(a, b);
        assert.equal(a, b);
      },
    },
  ],
});

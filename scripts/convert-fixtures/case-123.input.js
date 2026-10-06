const assert = require('node:assert');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

function same(a, b) {
  assert.equal(a, b);
}

module.exports = defineCases({
  description: 'case-123 file-level require',
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

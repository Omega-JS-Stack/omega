const defineCases = require('../../../../../src/test/define-cases.js');

const calls = globalThis.__runnerCalls;
calls.push('load B');
const loaded = require('./_real.js');

module.exports = defineCases({
  type: 'group',
  description: 'reading suite',
  tests: [
    {
      name: 'reads the real module',
      run: (ctx) => {
        calls.push('case B');
        ctx.expect(loaded).toEqual({ real: true });
      },
    },
  ],
});

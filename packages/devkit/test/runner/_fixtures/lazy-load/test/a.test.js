const defineCases = require('../../../../../src/test/define-cases.js');

// At load this file puts a stand-in for _real.js in the require cache, and its cleanup restores it.
const calls = globalThis.__runnerCalls;
const realPath = require.resolve('./_real.js');
const original = require.cache[realPath];
calls.push('load A');
require.cache[realPath] = { id: realPath, filename: realPath, loaded: true, exports: { real: false } };

module.exports = defineCases({
  type: 'group',
  description: 'mocking suite',
  cleanup() {
    if (original) require.cache[realPath] = original;
    else delete require.cache[realPath];
    calls.push('cleanup A');
  },
  tests: [
    { name: 'mocking case', run: () => { calls.push('case A'); } },
  ],
});

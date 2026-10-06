const defineCases = require('../../../../../src/test/define-cases.js');

const calls = globalThis.__runnerCalls;
calls.push('load A');

module.exports = defineCases({
  type: 'group',
  description: 'build suite A',
  layer: 'build',
  tests: [
    { name: 'case A', run: () => { calls.push('case A'); } },
  ],
});

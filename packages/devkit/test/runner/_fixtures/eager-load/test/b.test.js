const defineCases = require('../../../../../src/test/define-cases.js');

const calls = globalThis.__runnerCalls;
calls.push('load B');

module.exports = defineCases({
  type: 'group',
  description: 'build suite B',
  layer: 'build',
  tests: [
    { name: 'case B', run: () => { calls.push('case B'); } },
  ],
});

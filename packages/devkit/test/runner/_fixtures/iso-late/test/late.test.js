const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'late',
  tests: [
    { name: 'leaves a timer', run: () => { setTimeout(() => { throw new Error('late boom'); }, 50); } },
    { name: 'after it', run: () => new Promise((r) => setTimeout(r, 100)) },
  ],
});

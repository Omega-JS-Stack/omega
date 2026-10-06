const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'last good suite',
  tests: [
    { name: 'last good case', run: () => {} },
  ],
});

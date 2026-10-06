const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'first good suite',
  tests: [
    { name: 'first good case', run: () => {} },
    { name: 'second good case', run: () => {} },
  ],
});

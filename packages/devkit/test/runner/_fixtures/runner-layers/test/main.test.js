const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'main row suite',
  layer: 'main',
  tests: [
    { name: 'main case', run: () => {} },
  ],
});

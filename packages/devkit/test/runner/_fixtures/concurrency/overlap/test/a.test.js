const defineCases = require('../../../../../../src/test/define-cases.js');
const { timed } = require('../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'overlap a',
  tests: [
    { name: 'a runs longest', run: () => timed('a', 900) },
  ],
});

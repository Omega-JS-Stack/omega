const defineCases = require('../../../../../../src/test/define-cases.js');
const { timed } = require('../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'overlap b',
  tests: [
    { name: 'b runs short', run: () => timed('b', 200) },
  ],
});

const defineCases = require('../../../../../../src/test/define-cases.js');
const { timed } = require('../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'overlap c',
  tests: [
    { name: 'c runs short', run: () => timed('c', 200) },
  ],
});

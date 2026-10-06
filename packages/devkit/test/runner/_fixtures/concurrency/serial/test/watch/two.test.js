const defineCases = require('../../../../../../../src/test/define-cases.js');
const { timed } = require('../../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'serial watch two',
  tests: [
    { name: 'watch two runs', run: () => timed('watch-two', 400) },
  ],
});

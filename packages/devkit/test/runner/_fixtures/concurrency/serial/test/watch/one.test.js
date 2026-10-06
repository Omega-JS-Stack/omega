const defineCases = require('../../../../../../../src/test/define-cases.js');
const { timed } = require('../../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'serial watch one',
  tests: [
    { name: 'watch one runs', run: () => timed('watch-one', 400) },
  ],
});

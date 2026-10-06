const defineCases = require('../../../../../../src/test/define-cases.js');
const { timed } = require('../../record.js');

module.exports = defineCases({
  type: 'group',
  description: 'serial alpha',
  tests: [
    { name: 'alpha runs', run: () => timed('alpha', 400) },
  ],
});

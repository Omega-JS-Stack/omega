const defineCases = require('../../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'timeout',
  tests: [
    { name: 'waits 200ms', run: () => new Promise((resolve) => setTimeout(resolve, 200)) },
  ],
});

const defineCases = require('../../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'output alpha',
  tests: [
    {
      name: 'alpha case',
      async run() {
        process.stdout.write('ALPHA LINE\n');
        await new Promise((resolve) => setTimeout(resolve, 600));
      },
    },
  ],
});

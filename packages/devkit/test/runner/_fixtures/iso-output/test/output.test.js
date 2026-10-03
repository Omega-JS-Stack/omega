const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'case output',
  tests: [
    {
      name: 'writes to stdout and stderr',
      run(ctx) {
        fs.appendFileSync(process.env.FIXTURE_OUT, `${process.pid}\n`);
        process.stdout.write('ISO STDOUT LINE\n');
        process.stderr.write('ISO STDERR LINE\n');
        ctx.expect(1).toBe(1);
      },
    },
  ],
});

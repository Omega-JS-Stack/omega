const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'buffer write',
  tests: [
    {
      name: 'writes a Buffer to stdout',
      run(ctx) {
        process.stdout.write(Buffer.from('RAW BUFFER\n'));
        ctx.expect(1).toBe(1);
      },
    },
  ],
});

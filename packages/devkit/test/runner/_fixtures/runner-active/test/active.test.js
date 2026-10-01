const defineCases = require('../../../../../src/test/define-cases.js');

const spec = {
  type: 'group',
  description: 'runner active fixture',
  tests: [
    { name: 'must never register', run: (ctx) => ctx.expect(1).toBe(2) },
  ],
};

const returned = defineCases(spec);
process.stdout.write(returned === spec ? 'returned:same\n' : 'returned:different\n');

module.exports = returned;

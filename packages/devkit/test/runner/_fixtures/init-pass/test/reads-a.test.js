const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'reads the init marker a',
  tests: [
    { name: 'marker written once before case a', run: (ctx) => ctx.expect(fs.readFileSync(process.env.FIXTURE_OUT, 'utf8')).toBe('setup\n') },
  ],
});

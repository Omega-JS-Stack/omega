const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

const record = (line) => fs.appendFileSync(process.env.FIXTURE_OUT, `${line}\n`);

module.exports = defineCases({
  type: 'suite',
  description: 'suite setup',
  setup(ctx) {
    ctx.state.ready = true;
    record('setup');
  },
  tests: [
    { name: 'first reads the state', run: (ctx) => record(`first:${ctx.state.ready}`) },
    { name: 'second', run: () => record('second') },
    { name: 'third', run: () => record('third') },
  ],
});

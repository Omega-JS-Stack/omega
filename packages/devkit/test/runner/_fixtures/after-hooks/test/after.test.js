const fs = require('node:fs');
const defineCases = require('../../../../../src/test/define-cases.js');

const record = (line) => fs.appendFileSync(process.env.FIXTURE_OUT, `${line}\n`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = defineCases({
  type: 'group',
  description: 'ctx.after',
  tests: [
    {
      name: 'after runs in reverse on a pass',
      run(ctx) {
        ctx.after(() => record('pass:a'));
        ctx.after(async () => {
          await delay(20);
          record('pass:b');
        });
        record('pass:body');
      },
    },
    {
      name: 'after runs on a failure',
      run(ctx) {
        ctx.after(() => record('fail:a'));
        ctx.after(() => record('fail:b'));
        throw new Error('own failure');
      },
    },
    {
      name: 'after throws on a pass',
      run(ctx) {
        ctx.after(() => {
          throw new Error('after boom');
        });
        ctx.expect(1).toBe(1);
      },
    },
  ],
});

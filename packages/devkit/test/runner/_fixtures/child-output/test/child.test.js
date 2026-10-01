const { spawnSync } = require('node:child_process');
const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'child output',
  tests: [
    {
      name: 'spawns a child that writes to inherited stdout',
      run(ctx) {
        const child = spawnSync(process.execPath, ['-e', 'console.log("CHILD OUTPUT")'], { stdio: 'inherit' });
        ctx.expect(child.status).toBe(0);
      },
    },
  ],
});

const { execSync, execFileSync } = require('node:child_process');
const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'exec children',
  tests: [
    {
      name: 'runs execSync and execFileSync with inherited stdio',
      run(ctx) {
        execSync(`${JSON.stringify(process.execPath)} -e "console.log('EXECSYNC OUT')"`, { stdio: 'inherit' });
        execFileSync(process.execPath, ['-e', "console.log('EXECFILESYNC OUT')"], { stdio: 'inherit' });
        ctx.expect(1).toBe(1);
      },
    },
  ],
});

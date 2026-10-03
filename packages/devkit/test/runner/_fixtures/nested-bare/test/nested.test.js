const { spawnSync } = require('node:child_process');
const path = require('node:path');
const defineCases = require('../../../../../src/test/define-cases.js');

const INNER = path.join(__dirname, '_inner', 'inner.test.js');

module.exports = defineCases({
  type: 'group',
  description: 'a bare run inside the runner',
  tests: [
    {
      name: 'node <file> started by a case runs its own cases',
      run(ctx) {
        // The inner run is a plain `node <file>`, not a node:test child.
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const inner = spawnSync(process.execPath, [INNER], { env, encoding: 'utf8', timeout: 15000 });
        ctx.expect(inner.status, `${inner.stdout}${inner.stderr}`).toBe(0);
      },
    },
  ],
});

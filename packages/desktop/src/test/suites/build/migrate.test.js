// migrateTarget: the desktop leg of the brand root's `omega migrate`. Desktop
// carries no legacy move today, yet exposes the same entry as every framework,
// so the manager's walk never special-cases a framework name.

const path = require('path');
const fs = require('fs');
const os = require('os');

const SRC = path.join(__dirname, '..', '..', '..');
const { migrateTarget } = require(path.join(SRC, 'commands', 'lib', 'migrate.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'migrateTarget: the desktop leg answers the shared shape, empty',
  tests: [
    {
      name: 'report mode and execute both answer three empty lists',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-migrate-'));

        ctx.expect(migrateTarget(tmp)).toEqual({ due: [], changed: [], errors: [] });
        ctx.expect(migrateTarget(tmp, { execute: true })).toEqual({ due: [], changed: [], errors: [] });
        ctx.expect(fs.readdirSync(tmp)).toEqual([]);
      },
    },
  ],
});

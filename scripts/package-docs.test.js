/**
 * package-docs tests: the top-level docs/ is the one home for docs.
 *
 * Hand-written docs live in `docs/<framework>/`. No package has a docs/
 * folder of its own except the manager, whose copy is generated, and no
 * tracked file points into a package docs/ folder. CHANGELOG.md is exempt.
 *
 * Run: node --test scripts/package-docs.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PACKAGE_DOCS = /^packages\/([^/]+)\/docs\//;
const RETIRED_PATH = /packages\/(backend|client|desktop|extension|web)\/docs([^a-zA-Z0-9_-]|$)/;

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

module.exports = defineCases({
  type: 'group',
  description: 'package-docs',
  tests: [
    {
      name: 'no package but the manager has a docs/ folder on disk',
      run: (ctx) => {
        const folders = fs.readdirSync(path.join(ROOT, 'packages'))
          .filter((name) => name !== 'manager' && fs.existsSync(path.join(ROOT, 'packages', name, 'docs')));
        ctx.expect(folders, 'a leftover generated docs/ from an old prepare: delete it (docs live in docs/<framework>/)').toEqual([]);
      },
    },

    {
      name: 'no package but the manager tracks a docs/ folder',
      run: (ctx) => {
        const tracked = git(['ls-files', '-z', '--', 'packages/*/docs/'])
          .split('\0')
          .filter((file) => PACKAGE_DOCS.test(file) && file.match(PACKAGE_DOCS)[1] !== 'manager');
        ctx.expect(tracked, 'these docs belong in docs/<framework>/').toEqual([]);
      },
    },

    {
      name: 'no tracked file outside CHANGELOG.md names a package docs/ path',
      run: (ctx) => {
        let hits = '';
        try {
          hits = git(['grep', '-nE', RETIRED_PATH.source, '--', '.', ':(exclude)CHANGELOG.md']);
        } catch (error) {
          // git grep exits 1 when nothing matches, which is the passing case.
          if (error.status !== 1) throw error;
        }
        ctx.expect(hits.split('\n').filter(Boolean), 'point these at docs/<framework>/').toEqual([]);
      },
    },
  ],
});

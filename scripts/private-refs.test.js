/**
 * private-refs tests: the self-containment gate's reference shape has ONE
 * home, devkit's PRIVATE_REFERENCE, and every reader derives it: vendor.test's
 * dist assertions read the export, release-check scans with scanTree, and
 * CI's pack-smoke runs this script's CLI. Each reader must catch every
 * whitespace form a shipped raw reference can take.
 *
 * Run: node --test scripts/private-refs.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PRIVATE_REFERENCE } = require('../packages/devkit/tools/vendor');
const { scanTree } = require('./private-refs.js');

const SCRIPT = path.join(__dirname, 'private-refs.js');

// The forms a line-bound or `\s`-less grep misses.
const WHITESPACE_FORMS = {
  'spaced-require.js': `const config = require( '@omega.js/config');\n`,
  'from-newline.mjs': `import { track } from\n  '@omega.js/analytics';\n`,
  'spaced-import.cjs': `const load = () => import (  '@omega.js/analytics');\n`,
};

// A tree holding every whitespace form plus lines that are NOT private references.
function fixtureTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-refs-'));
  for (const [name, contents] of Object.entries(WHITESPACE_FORMS)) {
    fs.writeFileSync(path.join(dir, name), contents);
  }
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib', 'clean.js'), [
    `const client = require('@omega.js/client');`,
    `const tag = '[@omega.js/config:load]';`,
    `module.exports = { client, tag };`,
  ].join('\n'));
  return dir;
}

module.exports = defineCases({
  type: 'group',
  description: 'private-refs',
  tests: [
    {
      name: 'PRIVATE_REFERENCE: every whitespace form is a hit',
      run: (ctx) => {
        for (const [name, contents] of Object.entries(WHITESPACE_FORMS)) {
          ctx.expect(contents, `${name} is invisible to the export`).toMatch(PRIVATE_REFERENCE);
        }
      },
    },

    {
      name: 'scanTree: every whitespace form is a hit, reported at its line; published refs and prose are not',
      run: (ctx) => {
        const dir = fixtureTree();
        ctx.after(() => fs.rmSync(dir, { recursive: true, force: true }));

        const { hits, files } = scanTree(dir);

        ctx.expect(hits.sort()).toEqual(['from-newline.mjs:1', 'spaced-import.cjs:1', 'spaced-require.js:1']);
        ctx.expect(files).toBe(4);
      },
    },

    {
      name: 'CLI (the CI step): a tree with raw private references exits 1 naming each; a clean tree exits 0',
      run: (ctx) => {
        const dir = fixtureTree();
        ctx.after(() => fs.rmSync(dir, { recursive: true, force: true }));

        const dirty = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
        ctx.expect(dirty.status, dirty.stdout + dirty.stderr).toBe(1);
        for (const name of Object.keys(WHITESPACE_FORMS)) {
          ctx.expect(dirty.stderr).toMatch(new RegExp(`raw private ref: ${name.replace('.', '\\.')}:1`));
        }

        for (const name of Object.keys(WHITESPACE_FORMS)) {
          fs.rmSync(path.join(dir, name));
        }
        const clean = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
        ctx.expect(clean.status, clean.stdout + clean.stderr).toBe(0);
      },
    },
  ],
});

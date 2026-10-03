/**
 * Layer-aware seeding tests — the seed-mode resolution the four framework
 * setups branch on (friction #1: a brand target scaffolds NO local-layer config).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const { resolveSeedMode } = require('../src/index.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

function makeFixture(name, files) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

module.exports = defineCases({
  type: 'group',
  description: 'seed',
  tests: [
    {
      name: 'resolveSeedMode: brand target → brand mode; standalone dir → standalone; functions/ normalizes',
      run: (ctx) => {
        const root = makeFixture('seed-mode', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/targets/site/package.json': '{}',
          'brand/targets/backend/functions/package.json': '{}',
          'standalone/package.json': '{}',
        });
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        const brandRoot = path.join(root, 'brand');

        const inBrand = resolveSeedMode(path.join(brandRoot, 'targets', 'site'));
        ctx.expect(inBrand).toEqual({ standalone: false, brandRoot });

        const fromFunctions = resolveSeedMode(path.join(brandRoot, 'targets', 'backend', 'functions'));
        ctx.expect(fromFunctions).toEqual({ standalone: false, brandRoot });

        const standalone = resolveSeedMode(path.join(root, 'standalone'));
        ctx.expect(standalone).toEqual({ standalone: true, brandRoot: null });
      },
    },
  ],
});

/**
 * engines-floor: the family's Node floor follows where the code runs. Code
 * inside Cloud Functions carries the Functions runtime's floor, the backend's
 * `omega.functionsRuntime` (1st gen tops out below the toolchain); every other
 * package carries the toolchain floor, 24.
 *
 * The Functions side is the backend and every family package it carries, as a
 * runtime dependency or a vendored internal, and whatever those carry at runtime.
 *
 * Run: node --test scripts/engines-floor.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('fs');
const path = require('path');

const PACKAGES_DIR = path.join(__dirname, '..', 'packages');
const TOOLCHAIN_FLOOR = '>=24';

// Every workspace package's manifest, by its folder name.
function manifests() {
  const found = {};
  for (const name of fs.readdirSync(PACKAGES_DIR)) {
    const file = path.join(PACKAGES_DIR, name, 'package.json');
    if (fs.existsSync(file)) found[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return found;
}

const familyNames = (deps) => Object.keys(deps || {}).filter((name) => name.startsWith('@omega.js/'));

// The backend, what it ships with (runtime or vendored), and their runtime closure.
function functionsSide(byFolder) {
  const byName = Object.fromEntries(Object.values(byFolder).map((manifest) => [manifest.name, manifest]));
  const backend = byName['@omega.js/backend'];
  const side = new Set(['@omega.js/backend', ...familyNames(backend.dependencies), ...familyNames(backend.devDependencies)]);
  for (const name of side) {
    for (const dep of familyNames(byName[name].dependencies)) side.add(dep);
  }
  return side;
}

module.exports = defineCases({
  type: 'group',
  description: 'engines-floor',
  tests: [
    {
      name: 'Functions-side packages declare the Functions runtime floor; every other package declares >=24',
      run: (ctx) => {
        const byFolder = manifests();
        const runtime = byFolder.backend.omega.functionsRuntime;
        ctx.expect(runtime, 'the backend names its Functions runtime').toBeTruthy();

        const side = functionsSide(byFolder);
        const wrong = Object.values(byFolder)
          .map((manifest) => ({ name: manifest.name, want: side.has(manifest.name) ? `>=${runtime}` : TOOLCHAIN_FLOOR, has: (manifest.engines || {}).node }))
          .filter(({ want, has }) => want !== has)
          .map(({ name, want, has }) => `${name}: engines.node is ${has}, wants ${want}`);

        ctx.expect(wrong, wrong.join('\n')).toEqual([]);
      },
    },
  ],
});

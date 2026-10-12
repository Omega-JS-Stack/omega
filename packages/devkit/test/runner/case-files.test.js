/**
 * Every case file in the monorepo exports through `defineCases`: an unwrapped
 * spec loaded by `node --test <file>` registers nothing and reports a hollow
 * pass. The walk is the runner's own discovery over each tree a runner reads.
 */
const jetpack = require('fs-jetpack');
const path = require('node:path');
const defineCases = require('../../src/test/define-cases.js');
const { findTestFiles } = require('../../src/test/discovery.js');

const MONOREPO = path.join(__dirname, '..', '..', '..', '..');

// The directories directly under `rel`, relative to the monorepo; `.`-prefixed ones are scratch, as discovery reads them.
function dirsUnder(rel) {
  return (jetpack.list(path.join(MONOREPO, rel)) || [])
    .filter((name) => !name.startsWith('.') && jetpack.exists(path.join(MONOREPO, rel, name)) === 'dir')
    .map((name) => `${rel}/${name}`);
}

// Every package's test/, in-source suites and scaffold test/, every brand target's test/, and the root scripts/.
function caseRoots() {
  return [
    ...dirsUnder('packages').flatMap((pkg) => [`${pkg}/test`, `${pkg}/src/test/suites`, `${pkg}/src/defaults/test`]),
    ...dirsUnder('brands').flatMap((brand) => dirsUnder(`${brand}/targets`)).map((target) => `${target}/test`),
    'scripts',
  ];
}

module.exports = defineCases({
  type: 'group',
  description: 'case files: every one exports through defineCases',
  tests: [
    {
      name: 'every case file of the packages, their scaffolds, the brands and the root scripts exports through defineCases',
      run: (ctx) => {
        const files = caseRoots().flatMap((root) => findTestFiles(path.join(MONOREPO, root)));
        const unwrapped = files
          .filter((file) => !/module\.exports\s*=\s*defineCases\(/.test(jetpack.read(file)))
          .map((file) => path.relative(MONOREPO, file));

        ctx.expect(files.length > 0, 'the guard must walk case files').toBe(true);
        ctx.expect(unwrapped, `case files that report a hollow pass under \`node --test\`; wrap each as module.exports = defineCases({ ... }):\n${unwrapped.join('\n')}`).toEqual([]);
      },
    },
  ],
});

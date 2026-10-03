/**
 * framework-deps (#87): the ONE reader of a framework's declared dependency set
 * and the matcher every bundler hook is built from. The bundler half is pinned
 * against a real build in the framework lane that has one today —
 * packages/web/test/framework-deps.test.js.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { frameworkDependencyNames, frameworkDepsPattern } = require('../src/framework-deps.js');

// A framework package root carrying the given manifest.
function makeFramework(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-framework-deps-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@omega.js/fake', ...manifest }));
  return dir;
}

module.exports = defineCases({
  type: 'group',
  description: 'framework-deps',
  tests: [
    {
      name: 'the declared set IS the list — `@omega.js/*` deps excluded, devDependencies never counted',
      run: (ctx) => {
        const dir = makeFramework({
          dependencies: { 'chart.js': '^4.5.1', 'fs-jetpack': '^5.1.0', '@omega.js/client': '^0.1.0' },
          devDependencies: { webpack: '^5.0.0' },
        });

        ctx.expect(frameworkDependencyNames(dir)).toEqual(['chart.js', 'fs-jetpack']);
      },
    },

    {
      name: 'a package declaring no dependencies yields no names',
      run: (ctx) => {
        const dir = makeFramework({});

        ctx.expect(frameworkDependencyNames(dir)).toEqual([]);
      },
    },

    {
      name: 'the matcher takes the bare specifier and its subpaths, and nothing else',
      run: (ctx) => {
        const pattern = frameworkDepsPattern(['chart.js', '@popperjs/core']);

        ctx.expect(pattern.test('chart.js'), 'the bare specifier').toBeTruthy();
        ctx.expect(pattern.test('chart.js/auto'), 'a subpath').toBeTruthy();
        ctx.expect(pattern.test('@popperjs/core/lib/popper.js'), 'a scoped subpath').toBeTruthy();
        ctx.expect(!pattern.test('chart.js-extras'), 'a longer name that merely starts the same').toBeTruthy();
        // The `.` is escaped — a regex-naive matcher would take `chartxjs` here.
        ctx.expect(!pattern.test('chartxjs'), 'the dot is a literal, not a wildcard').toBeTruthy();
        ctx.expect(!pattern.test('lodash'), 'an undeclared name').toBeTruthy();
      },
    },
  ],
});

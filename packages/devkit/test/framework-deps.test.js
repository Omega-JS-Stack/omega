/**
 * framework-deps (#87): the ONE reader of a framework's declared dependency set
 * and the matcher every bundler hook is built from. The bundler half is pinned
 * against a real build in the framework lane that has one today —
 * packages/web/test/framework-deps.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('the declared set IS the list — `@omega.js/*` deps excluded, devDependencies never counted', () => {
  const dir = makeFramework({
    dependencies: { 'chart.js': '^4.5.1', 'fs-jetpack': '^5.1.0', '@omega.js/client': '^0.1.0' },
    devDependencies: { webpack: '^5.0.0' },
  });

  assert.deepEqual(frameworkDependencyNames(dir), ['chart.js', 'fs-jetpack']);
});

test('a package declaring no dependencies yields no names', () => {
  const dir = makeFramework({});

  assert.deepEqual(frameworkDependencyNames(dir), []);
});

test('the matcher takes the bare specifier and its subpaths, and nothing else', () => {
  const pattern = frameworkDepsPattern(['chart.js', '@popperjs/core']);

  assert.ok(pattern.test('chart.js'), 'the bare specifier');
  assert.ok(pattern.test('chart.js/auto'), 'a subpath');
  assert.ok(pattern.test('@popperjs/core/lib/popper.js'), 'a scoped subpath');
  assert.ok(!pattern.test('chart.js-extras'), 'a longer name that merely starts the same');
  // The `.` is escaped — a regex-naive matcher would take `chartxjs` here.
  assert.ok(!pattern.test('chartxjs'), 'the dot is a literal, not a wildcard');
  assert.ok(!pattern.test('lodash'), 'an undeclared name');
});

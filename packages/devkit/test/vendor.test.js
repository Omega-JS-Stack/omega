// Unit tests for tools/vendor.js — vendoring devkit into a host framework's dist.
//
// Fixtures are built under packages/devkit/.temp/ (gitignored) rather than os.tmpdir()
// ON PURPOSE: the runtime-load assertion requires that vendored modules can resolve
// their deps (chalk, node-powertools) by walking up to the monorepo root node_modules —
// which only works for paths inside the repo tree.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vendorDevkit = require('../tools/vendor');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// Build a minimal host-framework fixture and return its root.
function makeFixture(name, { packageJSON, files }) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJSON, null, 2));
  return root;
}

const HOST_DEPS = { chalk: '*', 'node-powertools': '*' };

test('copies devkit into dist/vendor, rewrites requires, and the result loads + runs', (t) => {
  const root = makeFixture('vendor-ok', {
    packageJSON: { name: 'fixture-host', version: '1.0.0', dependencies: HOST_DEPS },
    files: {
      'dist/lib/thing.js': [
        `const Logger = require('@omegajs/devkit/logger');`,
        `const { safeInstall } = require('@omegajs/devkit/safe-install');`,
        `const devkit = require("@omegajs/devkit");`,
        `module.exports = { Logger, safeInstall, devkit };`,
      ].join('\n'),
      'dist/untouched.js': `module.exports = 42;`,
    },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = vendorDevkit({ cwd: root });

  // Vendored modules exist
  for (const file of ['index.js', 'logger.js', 'safe-install.js', 'attach-log-file.js']) {
    assert.ok(fs.existsSync(path.join(root, 'dist', 'vendor', 'devkit', file)), `missing vendored ${file}`);
  }

  // Requires rewritten to relative paths, both quote styles, no @omegajs refs left
  const rewritten = fs.readFileSync(path.join(root, 'dist', 'lib', 'thing.js'), 'utf8');
  assert.match(rewritten, /require\('\.\.\/vendor\/devkit\/logger\.js'\)/);
  assert.match(rewritten, /require\("\.\.\/vendor\/devkit\/index\.js"\)/);
  assert.ok(!rewritten.includes('@omegajs'));
  assert.equal(result.rewritten, 1); // untouched.js stays untouched

  // The rewritten file actually loads and works (deps resolve up the monorepo tree)
  const thing = require(path.join(root, 'dist', 'lib', 'thing.js'));
  const logger = new thing.Logger('fixture');
  assert.equal(typeof logger.log, 'function');
  assert.equal(typeof thing.safeInstall, 'function');
  assert.equal(thing.devkit.Logger, thing.Logger);
});

test('is idempotent: running twice leaves dist identical', (t) => {
  const root = makeFixture('vendor-idem', {
    packageJSON: { name: 'fixture-idem', version: '1.0.0', dependencies: HOST_DEPS, preparePackage: { output: './dist' } },
    files: { 'dist/a.js': `module.exports = require('@omegajs/devkit/logger');` },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  vendorDevkit({ cwd: root });
  const first = fs.readFileSync(path.join(root, 'dist', 'a.js'), 'utf8');
  const second = vendorDevkit({ cwd: root });
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'a.js'), 'utf8'), first);
  assert.equal(second.rewritten, 0);
});

test('throws when the host is missing a runtime dep the vendored modules need', (t) => {
  const root = makeFixture('vendor-missing-dep', {
    packageJSON: { name: 'fixture-missing', version: '1.0.0', dependencies: { chalk: '*' } }, // no node-powertools
    files: { 'dist/a.js': `module.exports = require('@omegajs/devkit/safe-install');` },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(() => vendorDevkit({ cwd: root }), /node-powertools/);
});

test('throws on a require of a devkit module that does not exist', (t) => {
  const root = makeFixture('vendor-bad-subpath', {
    packageJSON: { name: 'fixture-bad', version: '1.0.0', dependencies: HOST_DEPS },
    files: { 'dist/a.js': `module.exports = require('@omegajs/devkit/nope');` },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(() => vendorDevkit({ cwd: root }), /no such module/);
});

test('throws when dist does not exist yet', (t) => {
  const root = makeFixture('vendor-no-dist', {
    packageJSON: { name: 'fixture-no-dist', version: '1.0.0', dependencies: HOST_DEPS },
    files: {},
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(() => vendorDevkit({ cwd: root }), /run prepare first/);
});

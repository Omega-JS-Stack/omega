// Unit tests for tools/vendor.js — vendoring @omegajs packages (devkit, account, ...)
// into a host framework's dist, for both CommonJS requires and ESM imports.
//
// Fixtures are built under packages/devkit/.temp/ (gitignored) rather than os.tmpdir()
// ON PURPOSE: the runtime-load assertion requires that vendored modules can resolve
// their deps (chalk, node-powertools) by walking up to the monorepo root node_modules —
// which only works for paths inside the repo tree.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
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

  // Vendored modules exist — index.js pulls the other three via its relative requires
  for (const file of ['index.js', 'logger.js', 'safe-install.js', 'attach-log-file.js']) {
    assert.ok(fs.existsSync(path.join(root, 'dist', 'vendor', 'devkit', file)), `missing vendored ${file}`);
  }
  // Selective: unused modules (e.g. the test runner) are NOT vendored
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'vendor', 'devkit', 'test')), 'test/ should not be vendored');

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

  assert.throws(() => vendorDevkit({ cwd: root }), /has no module/);
});

test('rewrites require.resolve() forms too (used to inline devkit module source)', (t) => {
  const root = makeFixture('vendor-resolve', {
    packageJSON: { name: 'fixture-resolve', version: '1.0.0', dependencies: HOST_DEPS },
    files: { 'dist/deep/reader.js': `module.exports = require.resolve('@omegajs/devkit/logger');` },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  vendorDevkit({ cwd: root });
  const rewritten = fs.readFileSync(path.join(root, 'dist', 'deep', 'reader.js'), 'utf8');
  assert.match(rewritten, /require\.resolve\('\.\.\/vendor\/devkit\/logger\.js'\)/);
  // And the resolved path actually points at a real vendored file
  const resolved = require(path.join(root, 'dist', 'deep', 'reader.js'));
  assert.ok(fs.existsSync(resolved));
});

test('vendors selectively: a safe-install-only host ships one module and needs only its deps', (t) => {
  const root = makeFixture('vendor-selective', {
    packageJSON: { name: 'fixture-selective', version: '1.0.0', dependencies: { 'node-powertools': '*' } }, // no chalk!
    files: { 'dist/a.js': `module.exports = require('@omegajs/devkit/safe-install');` },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = vendorDevkit({ cwd: root }); // must NOT throw about chalk/glob/fs-jetpack
  assert.deepEqual(result.vendored, { devkit: ['safe-install.js'] });
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'vendor', 'devkit', 'logger.js')));
});

test('rewrites ESM import forms and vendors multiple packages (devkit + account)', async (t) => {
  const root = makeFixture('vendor-esm', {
    packageJSON: { name: 'fixture-esm', version: '1.0.0', dependencies: HOST_DEPS },
    files: {
      'dist/module.js': [
        `import { resolveAccount, resolveSubscription } from '@omegajs/account';`,
        `import Logger from '@omegajs/devkit/logger';`,
        `export { default as engineExports } from '@omegajs/account/engine';`,
        `import '@omegajs/account/subscription';`,
        `const schema = await import('@omegajs/account/schema');`,
        `export const account = resolveAccount({});`,
        `export const resolved = resolveSubscription(account);`,
        `export const hasAuthBranch = !!schema.default.auth;`,
        `export const logger = new Logger('esm-fixture');`,
      ].join('\n'),
    },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = vendorDevkit({ cwd: root });

  // Every ESM reference form rewritten, nothing @omegajs left behind
  const rewritten = fs.readFileSync(path.join(root, 'dist', 'module.js'), 'utf8');
  assert.match(rewritten, /from '\.\/vendor\/account\/index\.js'/);
  assert.match(rewritten, /from '\.\/vendor\/devkit\/logger\.js'/);
  assert.match(rewritten, /from '\.\/vendor\/account\/engine\.js'/);
  assert.match(rewritten, /import '\.\/vendor\/account\/subscription\.js'/);
  assert.match(rewritten, /import\('\.\/vendor\/account\/schema\.js'\)/);
  assert.ok(!rewritten.includes('@omegajs'));
  assert.deepEqual(Object.keys(result.vendored).sort(), ['account', 'devkit']);

  // The rewritten ESM file actually loads — named imports from the vendored
  // CommonJS account modules must work through Node's CJS/ESM interop
  const mod = await import(pathToFileURL(path.join(root, 'dist', 'module.js')));
  assert.equal(mod.account.subscription.product.id, 'basic');
  assert.equal(mod.resolved.everPaid, false);
  assert.equal(mod.hasAuthBranch, true);
  assert.equal(typeof mod.logger.log, 'function');
});

test('throws when dist does not exist yet', (t) => {
  const root = makeFixture('vendor-no-dist', {
    packageJSON: { name: 'fixture-no-dist', version: '1.0.0', dependencies: HOST_DEPS },
    files: {},
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(() => vendorDevkit({ cwd: root }), /run prepare first/);
});

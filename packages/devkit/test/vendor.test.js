// Unit tests for tools/vendor.js — vendoring @omega.js packages (devkit, account, ...)
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
        `const Logger = require('@omega.js/devkit/logger');`,
        `const { safeInstall } = require('@omega.js/devkit/safe-install');`,
        `const devkit = require("@omega.js/devkit");`,
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

  // Requires rewritten to relative paths, both quote styles, no @omega.js refs left
  const rewritten = fs.readFileSync(path.join(root, 'dist', 'lib', 'thing.js'), 'utf8');
  assert.match(rewritten, /require\('\.\.\/vendor\/devkit\/logger\.js'\)/);
  assert.match(rewritten, /require\("\.\.\/vendor\/devkit\/index\.js"\)/);
  assert.ok(!rewritten.includes('@omega.js'));
  assert.equal(result.rewritten, 1); // untouched.js stays untouched

  // The rewritten file actually loads and works (deps resolve up the monorepo tree)
  const thing = require(path.join(root, 'dist', 'lib', 'thing.js'));
  const logger = new thing.Logger('fixture');
  assert.equal(typeof logger.log, 'function');
  assert.equal(typeof thing.safeInstall, 'function');
  assert.equal(thing.devkit.Logger, thing.Logger);
});

test('dist/defaults is consumer-template content: never scanned, rewritten, or vendored', (t) => {
  const root = makeFixture('vendor-defaults', {
    packageJSON: { name: '@omega.js/fixture-fw', version: '2.0.0', dependencies: HOST_DEPS },
    files: {
      'dist/lib/thing.js': `const Logger = require('@omega.js/devkit/logger');\nmodule.exports = Logger;`,
      // A framework's defaults reference the framework itself — scanning them
      // would try to vendor the host into itself (unresolvable and wrong)
      'dist/defaults/src/component.js': `import Manager from '@omega.js/fixture-fw/background';\nexport default Manager;`,
    },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = vendorDevkit({ cwd: root }); // must NOT throw about @omega.js/fixture-fw

  // The consumer template keeps its package specifier verbatim
  const template = fs.readFileSync(path.join(root, 'dist', 'defaults', 'src', 'component.js'), 'utf8');
  assert.ok(template.includes(`'@omega.js/fixture-fw/background'`));
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'vendor', 'fixture-fw')));

  // Host code is still vendored + rewritten as usual
  assert.equal(result.rewritten, 1);
  assert.ok(fs.existsSync(path.join(root, 'dist', 'vendor', 'devkit', 'logger.js')));
});

test("the host's own name is never vendored or rewritten (boot harnesses + fixtures reference it at consumer runtime)", (t) => {
  // The real case: @omega.js/desktop's boot harness requires
  // '@omega.js/desktop/renderer' and its bundled consumer fixture requires
  // '@omega.js/desktop/main' — both resolve via the CONSUMER's node_modules
  // (the boot runner symlinks them). Collecting the host's own name would
  // fold the host into itself; rewriting would break the consumer-side walk.
  const root = makeFixture('vendor-self', {
    packageJSON: { name: '@omega.js/fixture-self', version: '2.0.0', dependencies: HOST_DEPS },
    files: {
      'dist/test/harness/preload.js': `const R = require('@omega.js/fixture-self/renderer');\nconst L = require('@omega.js/devkit/logger');\nmodule.exports = { R, L };`,
    },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = vendorDevkit({ cwd: root }); // must NOT throw about @omega.js/fixture-self

  // Self-reference survives verbatim; the sibling ref is still rewritten
  const harness = fs.readFileSync(path.join(root, 'dist', 'test', 'harness', 'preload.js'), 'utf8');
  assert.ok(harness.includes(`'@omega.js/fixture-self/renderer'`));
  assert.ok(!harness.includes(`'@omega.js/devkit/logger'`));
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'vendor', 'fixture-self')));
  assert.ok(fs.existsSync(path.join(root, 'dist', 'vendor', 'devkit', 'logger.js')));
  assert.equal(result.rewritten, 1);
});

test('dep-guard ignores comment prose that reads like an ESM from-clause', (t) => {
  // The real case: @omega.js/config's edit.js has JSDoc prose "('brand' from
  // brand, 'a b' from 'a b')" — the guard reported a phantom host dep 'a b'.
  const root = makeFixture('vendor-prose', {
    packageJSON: { name: 'fixture-prose', version: '1.0.0', dependencies: { json5: '*', dotenv: '*' } }, // dotenv: config's env.js rides along
    files: {
      'dist/lib/uses-config.js': `const config = require('@omega.js/config');\nmodule.exports = config;`,
    },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  vendorDevkit({ cwd: root }); // must NOT throw about a phantom 'a b' dep

  assert.ok(fs.existsSync(path.join(root, 'dist', 'vendor', 'config', 'edit.js')));
});

test('is idempotent: running twice leaves dist identical', (t) => {
  const root = makeFixture('vendor-idem', {
    packageJSON: { name: 'fixture-idem', version: '1.0.0', dependencies: HOST_DEPS, preparePackage: { output: './dist' } },
    files: { 'dist/a.js': `module.exports = require('@omega.js/devkit/logger');` },
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
    files: { 'dist/a.js': `module.exports = require('@omega.js/devkit/safe-install');` },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(() => vendorDevkit({ cwd: root }), /node-powertools/);
});

test('throws on a require of a devkit module that does not exist', (t) => {
  const root = makeFixture('vendor-bad-subpath', {
    packageJSON: { name: 'fixture-bad', version: '1.0.0', dependencies: HOST_DEPS },
    files: { 'dist/a.js': `module.exports = require('@omega.js/devkit/nope');` },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(() => vendorDevkit({ cwd: root }), /has no module/);
});

test('rewrites require.resolve() forms too (used to inline devkit module source)', (t) => {
  const root = makeFixture('vendor-resolve', {
    packageJSON: { name: 'fixture-resolve', version: '1.0.0', dependencies: HOST_DEPS },
    files: { 'dist/deep/reader.js': `module.exports = require.resolve('@omega.js/devkit/logger');` },
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
    files: { 'dist/a.js': `module.exports = require('@omega.js/devkit/safe-install');` },
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
        `import { resolveAccount, resolveSubscription } from '@omega.js/account';`,
        `import Logger from '@omega.js/devkit/logger';`,
        `export { default as engineExports } from '@omega.js/account/engine';`,
        `import '@omega.js/account/subscription';`,
        `const schema = await import('@omega.js/account/schema');`,
        `export const account = resolveAccount({});`,
        `export const resolved = resolveSubscription(account);`,
        `export const hasAuthBranch = !!schema.default.auth;`,
        `export const logger = new Logger('esm-fixture');`,
      ].join('\n'),
    },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = vendorDevkit({ cwd: root });

  // Every ESM reference form rewritten, nothing @omega.js left behind
  const rewritten = fs.readFileSync(path.join(root, 'dist', 'module.js'), 'utf8');
  assert.match(rewritten, /from '\.\/vendor\/account\/index\.js'/);
  assert.match(rewritten, /from '\.\/vendor\/devkit\/logger\.js'/);
  assert.match(rewritten, /from '\.\/vendor\/account\/engine\.js'/);
  assert.match(rewritten, /import '\.\/vendor\/account\/subscription\.js'/);
  assert.match(rewritten, /import\('\.\/vendor\/account\/schema\.js'\)/);
  assert.ok(!rewritten.includes('@omega.js'));
  assert.deepEqual(Object.keys(result.vendored).sort(), ['account', 'devkit']);

  // The rewritten ESM file actually loads — named imports from the vendored
  // CommonJS account modules must work through Node's CJS/ESM interop
  const mod = await import(pathToFileURL(path.join(root, 'dist', 'module.js')));
  assert.equal(mod.account.subscription.product.id, 'basic');
  assert.equal(mod.resolved.everPaid, false);
  assert.equal(mod.hasAuthBranch, true);
  assert.equal(typeof mod.logger.log, 'function');
});

test('host scan skips node_modules and never follows symlinks (@omega.js/backend fixture tree)', (t) => {
  const root = makeFixture('vendor-symlink', {
    packageJSON: { name: 'fixture-symlink', version: '1.0.0', dependencies: HOST_DEPS },
    files: {
      'dist/lib/uses.js': `module.exports = require('@omega.js/devkit/logger');`,
      // A consumer-fixture dependency inside dist — its @omega.js reference is
      // NOT host code and must be neither vendored-for nor rewritten
      'dist/test/fixtures/project/node_modules/dep/index.js': `module.exports = require('@omega.js/devkit/safe-install');`,
    },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // @omega.js/backend's self-test fixture ships a circular self-symlink (@omega.js/backend -> package root)
  fs.symlinkSync(root, path.join(root, 'dist', 'test', 'fixtures', 'project', 'node_modules', 'circular'));

  const result = vendorDevkit({ cwd: root }); // used to die with ENAMETOOLONG

  assert.deepEqual(result.vendored, { devkit: ['logger.js'] }); // fixture dep's safe-install ref NOT honored
  assert.equal(result.rewritten, 1);
  const untouched = fs.readFileSync(path.join(root, 'dist', 'test', 'fixtures', 'project', 'node_modules', 'dep', 'index.js'), 'utf8');
  assert.ok(untouched.includes(`require('@omega.js/devkit/safe-install')`), 'node_modules content must not be rewritten');
});

test('throws when dist does not exist yet', (t) => {
  const root = makeFixture('vendor-no-dist', {
    packageJSON: { name: 'fixture-no-dist', version: '1.0.0', dependencies: HOST_DEPS },
    files: {},
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(() => vendorDevkit({ cwd: root }), /run prepare first/);
});

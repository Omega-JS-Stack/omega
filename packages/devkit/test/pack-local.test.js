// Unit tests for src/pack-local.js: the ONE pack step every snapshot deploy
// rides ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
//
// Real npm in throwaway dirs, no mocks. What is being pinned is npm's own
// resolution of the staged shape (a `file:` tarball spec per manifest, an
// override for a nested one, a lockfile that never asks the registry), and
// only a real `npm pack` + `npm install --package-lock-only` can answer for
// that. Every fixture is offline by construction: file: specs and local
// tarballs only.
//
// The cases carried over from @omega.js/backend's deploy-staging suite (the
// module this one generalizes) are the first four; the workspace-root and
// two-hop cases are what a BRAND root and the runner's second stage need.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { stageLocalPackages } = require('../src/pack-local.js');

/** A throwaway dir for one case. */
function makeTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-pack-local-')));
}

/** Write a package.json, the trailing newline npm writes included. */
function writeManifest(dir, manifest) {
  jetpack.write(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** A tiny real package on disk. */
function writePackage(dir, manifest) {
  writeManifest(dir, { private: true, main: 'index.js', ...manifest });
  jetpack.write(path.join(dir, 'index.js'), 'module.exports = 1;\n');
}

const read = (file) => jetpack.read(file, 'json');

test('stages the file: deps pointing OUTSIDE the dir, and restores them verbatim', async () => {
  const tmp = makeTmp();

  // A tiny real package OUTSIDE the staged dir...
  writePackage(path.join(tmp, 'fakepkg'), { name: '@omega.js/fakepkg', version: '1.0.0' });

  // ...referenced the way a functions dir does it
  const dir = path.join(tmp, 'functions');
  writeManifest(dir, {
    name: 'test-functions',
    version: '0.0.1',
    private: true,
    dependencies: { '@omega.js/fakepkg': 'file:../fakepkg' },
  });

  const staging = await stageLocalPackages({ dir });

  assert.deepEqual(staging.staged, ['@omega.js/fakepkg']);
  assert.equal(read(path.join(dir, 'package.json')).dependencies['@omega.js/fakepkg'], 'file:omega_modules/omega.js-fakepkg-1.0.0.tgz');
  assert.equal(jetpack.exists(path.join(dir, 'omega_modules', 'omega.js-fakepkg-1.0.0.tgz')), 'file');

  const lock = read(path.join(dir, 'package-lock.json'));
  assert.ok(lock, 'lockfile generated for the staged shape');
  assert.ok(lock.packages['node_modules/@omega.js/fakepkg'], 'lockfile resolves the staged tarball');

  await staging.restore();
  assert.equal(read(path.join(dir, 'package.json')).dependencies['@omega.js/fakepkg'], 'file:../fakepkg');
  assert.equal(jetpack.exists(path.join(dir, 'package-lock.json')), false, 'lockfile absent again (none existed before)');
  assert.equal(jetpack.exists(path.join(dir, 'omega_modules')), false, 'staging dir removed');

  jetpack.remove(tmp);
});

test('a dir with no outside file: deps stages nothing', async () => {
  const tmp = makeTmp();

  const dir = path.join(tmp, 'functions');
  writeManifest(dir, {
    name: 'fns',
    version: '1.0.0',
    private: true,
    dependencies: { 'firebase-admin': '^13.0.0' },
  });

  const staging = await stageLocalPackages({ dir });

  assert.deepEqual(staging.staged, []);
  assert.equal(jetpack.exists(path.join(dir, 'omega_modules')), false, 'nothing staged');
  assert.equal(jetpack.exists(path.join(dir, 'package-lock.json')), false, 'no lockfile regenerated for a no-op');
  await staging.restore(); // harmless no-op

  jetpack.remove(tmp);
});

test('#331: a linked @omega.js dep of a packed package rides too, so the lock never asks the registry', async () => {
  const tmp = makeTmp();

  // A local @omega.js package that exists NOWHERE but this disk: the
  // registry-404 shape (client under the publish latch)
  const depDir = path.join(tmp, 'workspace', 'faketransitive');
  writePackage(depDir, { name: '@omega.js/faketransitive', version: '0.1.0' });

  // The framework package declares it by REGISTRY spec (that is how
  // @omega.js/backend spells @omega.js/client) and resolves it through a
  // node_modules SYMLINK, the local-era shape npm workspaces make
  const pkgDir = path.join(tmp, 'fakeframework');
  writePackage(pkgDir, {
    name: '@omega.js/fakeframework',
    version: '1.0.0',
    dependencies: { '@omega.js/faketransitive': '^0.1.0' },
  });
  jetpack.dir(path.join(pkgDir, 'node_modules', '@omega.js'));
  fs.symlinkSync(depDir, path.join(pkgDir, 'node_modules', '@omega.js', 'faketransitive'), 'dir');

  const dir = path.join(tmp, 'functions');
  writeManifest(dir, {
    name: 'test-functions',
    version: '0.0.1',
    private: true,
    dependencies: { '@omega.js/fakeframework': 'file:../fakeframework' },
  });

  const staging = await stageLocalPackages({ dir });

  assert.deepEqual(staging.staged, ['@omega.js/fakeframework', '@omega.js/faketransitive']);
  assert.equal(jetpack.exists(path.join(dir, 'omega_modules', 'omega.js-fakeframework-1.0.0.tgz')), 'file');
  assert.equal(jetpack.exists(path.join(dir, 'omega_modules', 'omega.js-faketransitive-0.1.0.tgz')), 'file');

  // The framework tarball still declares `^0.1.0` internally, so only an
  // override redirects that NESTED resolution to the artifact beside it
  const staged = read(path.join(dir, 'package.json'));
  assert.equal(staged.dependencies['@omega.js/fakeframework'], 'file:omega_modules/omega.js-fakeframework-1.0.0.tgz');
  assert.equal(staged.overrides['@omega.js/faketransitive'], 'file:omega_modules/omega.js-faketransitive-0.1.0.tgz');

  const locked = read(path.join(dir, 'package-lock.json')).packages['node_modules/@omega.js/faketransitive'];
  assert.ok(locked, 'the linked dependency is in the lockfile');
  assert.equal(locked.resolved, 'file:omega_modules/omega.js-faketransitive-0.1.0.tgz');

  await staging.restore();
  assert.equal(read(path.join(dir, 'package.json')).overrides, undefined, 'staging overrides never survive the restore');
  assert.equal(jetpack.exists(path.join(dir, 'omega_modules')), false, 'staging dir removed');

  jetpack.remove(tmp);
});

test('#331: a failing stage restores first and throws, so nothing deploys from a half-staged folder', async () => {
  const tmp = makeTmp();

  writePackage(path.join(tmp, 'fakepkg'), { name: '@omega.js/fakepkg', version: '1.0.0' });

  // The pack succeeds, then the LOCK REGEN fails (a file: spec pointing at a
  // tarball that does not exist): the failure lands AFTER the manifest was
  // respelled on disk, which is exactly where the 404 landed
  const dir = path.join(tmp, 'functions');
  const original = `${JSON.stringify({
    name: 'test-functions',
    version: '0.0.1',
    private: true,
    dependencies: {
      '@omega.js/fakepkg': 'file:../fakepkg',
      'never-here': 'file:../missing-tarball.tgz',
    },
  }, null, 2)}\n`;
  jetpack.write(path.join(dir, 'package.json'), original);

  let message = '';
  try {
    await stageLocalPackages({ dir });
  } catch (e) {
    message = e.message;
  }

  assert.ok(message, 'a failing stage throws, and the deploy stops');
  assert.match(message, /staging failed/i, `the error names the staging lane: ${message}`);
  assert.equal(jetpack.read(path.join(dir, 'package.json')), original, 'manifest restored verbatim');
  assert.equal(jetpack.exists(path.join(dir, 'omega_modules')), false, 'no half-staged tarballs left behind');
  assert.equal(jetpack.exists(path.join(dir, 'package-lock.json')), false, 'no half-written lockfile left behind');

  jetpack.remove(tmp);
});

/**
 * A brand-shaped fixture: two linked packages (one pulling the other through a
 * node_modules symlink), a workspace root that links one directly, and a member
 * target that links it at its own depth.
 * @param {string} tmp - The throwaway base dir.
 * @returns {{ brandRoot: string, website: string }} The brand root and its member.
 */
function buildBrand(tmp) {
  const libb = path.join(tmp, 'packages', 'libb');
  const liba = path.join(tmp, 'packages', 'liba');
  writePackage(libb, { name: '@omega.js/libb', version: '0.1.0' });
  writePackage(liba, { name: '@omega.js/liba', version: '1.0.0', dependencies: { '@omega.js/libb': '^0.1.0' } });
  jetpack.dir(path.join(liba, 'node_modules', '@omega.js'));
  fs.symlinkSync(libb, path.join(liba, 'node_modules', '@omega.js', 'libb'), 'dir');

  const brandRoot = path.join(tmp, 'brand');
  writeManifest(brandRoot, {
    name: 'brand',
    version: '0.0.1',
    private: true,
    workspaces: ['targets/*'],
    devDependencies: { '@omega.js/liba': 'file:../packages/liba' },
  });

  const website = path.join(brandRoot, 'targets', 'website');
  writeManifest(website, {
    name: 'brand-website',
    version: '0.0.1',
    private: true,
    dependencies: { '@omega.js/liba': 'file:../../../packages/liba' },
  });

  return { brandRoot, website };
}

test('a workspace root stages its members too, each spec relative to ITS manifest', async () => {
  const tmp = makeTmp();
  const { brandRoot, website } = buildBrand(tmp);
  const rootManifest = jetpack.read(path.join(brandRoot, 'package.json'));
  const memberManifest = jetpack.read(path.join(website, 'package.json'));

  const staging = await stageLocalPackages({ dir: brandRoot });

  assert.deepEqual(staging.staged, ['@omega.js/liba', '@omega.js/libb']);
  assert.equal(jetpack.exists(path.join(brandRoot, 'omega_modules', 'omega.js-liba-1.0.0.tgz')), 'file');
  assert.equal(jetpack.exists(path.join(brandRoot, 'omega_modules', 'omega.js-libb-0.1.0.tgz')), 'file');

  const root = read(path.join(brandRoot, 'package.json'));
  assert.equal(root.devDependencies['@omega.js/liba'], 'file:omega_modules/omega.js-liba-1.0.0.tgz');
  assert.equal(root.overrides['@omega.js/libb'], 'file:omega_modules/omega.js-libb-0.1.0.tgz');

  // The member's spec is relative to the MEMBER, never to the staged root
  const member = read(path.join(website, 'package.json'));
  assert.equal(member.dependencies['@omega.js/liba'], 'file:../../omega_modules/omega.js-liba-1.0.0.tgz');
  assert.equal(member.overrides, undefined, 'overrides belong to the install root only');

  const lock = read(path.join(brandRoot, 'package-lock.json'));
  assert.ok(lock, 'the install root carries the regenerated lockfile');
  assert.equal(lock.packages['node_modules/@omega.js/liba'].resolved, 'file:omega_modules/omega.js-liba-1.0.0.tgz');
  assert.equal(lock.packages['node_modules/@omega.js/libb'].resolved, 'file:omega_modules/omega.js-libb-0.1.0.tgz');

  await staging.restore();
  assert.equal(jetpack.read(path.join(brandRoot, 'package.json')), rootManifest, 'root manifest restored byte-for-byte');
  assert.equal(jetpack.read(path.join(website, 'package.json')), memberManifest, 'member manifest restored byte-for-byte');
  assert.equal(jetpack.exists(path.join(brandRoot, 'omega_modules')), false, 'staging dir removed');
  assert.equal(jetpack.exists(path.join(brandRoot, 'package-lock.json')), false, 'lockfile absent again');

  jetpack.remove(tmp);
});

test('second hop: a member of an already-staged tree COPIES the tarballs and packs nothing', async () => {
  const tmp = makeTmp();
  const { brandRoot } = buildBrand(tmp);

  const first = await stageLocalPackages({ dir: brandRoot });

  // What the runner receives: the staged tree ALONE. The package sources the
  // first hop packed are nowhere near it, so anything this hop tried to pack
  // again would fail rather than quietly re-packing.
  const snapshot = path.join(tmp, 'runner', 'brand');
  jetpack.copy(brandRoot, snapshot);
  await first.restore();
  jetpack.remove(path.join(tmp, 'packages'));

  const website = path.join(snapshot, 'targets', 'website');
  const staging = await stageLocalPackages({ dir: website });

  assert.deepEqual(staging.staged, ['@omega.js/liba', '@omega.js/libb']);
  assert.equal(jetpack.exists(path.join(website, 'omega_modules', 'omega.js-liba-1.0.0.tgz')), 'file');
  assert.equal(jetpack.exists(path.join(website, 'omega_modules', 'omega.js-libb-0.1.0.tgz')), 'file', 'the ROOT override travelled with the member');

  const member = read(path.join(website, 'package.json'));
  assert.equal(member.dependencies['@omega.js/liba'], 'file:omega_modules/omega.js-liba-1.0.0.tgz');
  assert.equal(member.overrides['@omega.js/libb'], 'file:omega_modules/omega.js-libb-0.1.0.tgz');

  const lock = read(path.join(website, 'package-lock.json'));
  assert.ok(lock, 'the member is its own install root now');
  assert.equal(lock.packages['node_modules/@omega.js/liba'].resolved, 'file:omega_modules/omega.js-liba-1.0.0.tgz');
  assert.equal(lock.packages['node_modules/@omega.js/libb'].resolved, 'file:omega_modules/omega.js-libb-0.1.0.tgz');

  await staging.restore();
  assert.equal(read(path.join(website, 'package.json')).dependencies['@omega.js/liba'], 'file:../../omega_modules/omega.js-liba-1.0.0.tgz', 'the first hop\'s spelling is back');
  assert.equal(jetpack.exists(path.join(website, 'omega_modules')), false, 'staging dir removed');

  jetpack.remove(tmp);
});

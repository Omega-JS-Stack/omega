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

const defineCases = require('@omega.js/devkit/test/define-cases');
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

/**
 * A brand-shaped fixture: two linked packages (one pulling the other through a
 * node_modules symlink), a workspace root that links one directly, and a member
 * target that links it at its own depth.
 * @param {string} tmp - The throwaway base dir.
 * @returns {{ brandRoot: string, web: string }} The brand root and its member.
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

  const web = path.join(brandRoot, 'targets', 'web');
  writeManifest(web, {
    name: 'brand-web',
    version: '0.0.1',
    private: true,
    dependencies: { '@omega.js/liba': 'file:../../../packages/liba' },
  });

  return { brandRoot, web };
}

module.exports = defineCases({
  type: 'group',
  description: 'pack-local',
  tests: [
    {
      name: 'stages the file: deps pointing OUTSIDE the dir, and restores them verbatim',
      run: async (ctx) => {
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

        ctx.expect(staging.staged).toEqual(['@omega.js/fakepkg']);
        ctx.expect(read(path.join(dir, 'package.json')).dependencies['@omega.js/fakepkg']).toBe('file:omega_modules/omega.js-fakepkg-1.0.0.tgz');
        ctx.expect(jetpack.exists(path.join(dir, 'omega_modules', 'omega.js-fakepkg-1.0.0.tgz'))).toBe('file');

        const lock = read(path.join(dir, 'package-lock.json'));
        ctx.expect(lock, 'lockfile generated for the staged shape').toBeTruthy();
        ctx.expect(lock.packages['node_modules/@omega.js/fakepkg'], 'lockfile resolves the staged tarball').toBeTruthy();

        await staging.restore();
        ctx.expect(read(path.join(dir, 'package.json')).dependencies['@omega.js/fakepkg']).toBe('file:../fakepkg');
        ctx.expect(jetpack.exists(path.join(dir, 'package-lock.json')), 'lockfile absent again (none existed before)').toBe(false);
        ctx.expect(jetpack.exists(path.join(dir, 'omega_modules')), 'staging dir removed').toBe(false);

        jetpack.remove(tmp);
      },
    },

    {
      name: 'a dir with no outside file: deps stages nothing',
      run: async (ctx) => {
        const tmp = makeTmp();

        const dir = path.join(tmp, 'functions');
        writeManifest(dir, {
          name: 'fns',
          version: '1.0.0',
          private: true,
          dependencies: { 'firebase-admin': '^13.0.0' },
        });

        const staging = await stageLocalPackages({ dir });

        ctx.expect(staging.staged).toEqual([]);
        ctx.expect(jetpack.exists(path.join(dir, 'omega_modules')), 'nothing staged').toBe(false);
        ctx.expect(jetpack.exists(path.join(dir, 'package-lock.json')), 'no lockfile regenerated for a no-op').toBe(false);
        await staging.restore(); // harmless no-op

        jetpack.remove(tmp);
      },
    },

    {
      name: '#331: a linked @omega.js dep of a packed package rides too, so the lock never asks the registry',
      run: async (ctx) => {
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

        ctx.expect(staging.staged).toEqual(['@omega.js/fakeframework', '@omega.js/faketransitive']);
        ctx.expect(jetpack.exists(path.join(dir, 'omega_modules', 'omega.js-fakeframework-1.0.0.tgz'))).toBe('file');
        ctx.expect(jetpack.exists(path.join(dir, 'omega_modules', 'omega.js-faketransitive-0.1.0.tgz'))).toBe('file');

        // The framework tarball still declares `^0.1.0` internally, so only an
        // override redirects that NESTED resolution to the artifact beside it
        const staged = read(path.join(dir, 'package.json'));
        ctx.expect(staged.dependencies['@omega.js/fakeframework']).toBe('file:omega_modules/omega.js-fakeframework-1.0.0.tgz');
        ctx.expect(staged.overrides['@omega.js/faketransitive']).toBe('file:omega_modules/omega.js-faketransitive-0.1.0.tgz');

        const locked = read(path.join(dir, 'package-lock.json')).packages['node_modules/@omega.js/faketransitive'];
        ctx.expect(locked, 'the linked dependency is in the lockfile').toBeTruthy();
        ctx.expect(locked.resolved).toBe('file:omega_modules/omega.js-faketransitive-0.1.0.tgz');

        await staging.restore();
        ctx.expect(read(path.join(dir, 'package.json')).overrides, 'staging overrides never survive the restore').toBe(undefined);
        ctx.expect(jetpack.exists(path.join(dir, 'omega_modules')), 'staging dir removed').toBe(false);

        jetpack.remove(tmp);
      },
    },

    {
      name: '#331: a failing stage restores first and throws, so nothing deploys from a half-staged folder',
      run: async (ctx) => {
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

        ctx.expect(message, 'a failing stage throws, and the deploy stops').toBeTruthy();
        ctx.expect(message, `the error names the staging lane: ${message}`).toMatch(/staging failed/i);
        ctx.expect(jetpack.read(path.join(dir, 'package.json')), 'manifest restored verbatim').toBe(original);
        ctx.expect(jetpack.exists(path.join(dir, 'omega_modules')), 'no half-staged tarballs left behind').toBe(false);
        ctx.expect(jetpack.exists(path.join(dir, 'package-lock.json')), 'no half-written lockfile left behind').toBe(false);

        jetpack.remove(tmp);
      },
    },

    {
      name: 'a workspace root stages its members too, each spec relative to ITS manifest',
      run: async (ctx) => {
        const tmp = makeTmp();
        const { brandRoot, web } = buildBrand(tmp);
        const rootManifest = jetpack.read(path.join(brandRoot, 'package.json'));
        const memberManifest = jetpack.read(path.join(web, 'package.json'));

        const staging = await stageLocalPackages({ dir: brandRoot });

        ctx.expect(staging.staged).toEqual(['@omega.js/liba', '@omega.js/libb']);
        ctx.expect(jetpack.exists(path.join(brandRoot, 'omega_modules', 'omega.js-liba-1.0.0.tgz'))).toBe('file');
        ctx.expect(jetpack.exists(path.join(brandRoot, 'omega_modules', 'omega.js-libb-0.1.0.tgz'))).toBe('file');

        const root = read(path.join(brandRoot, 'package.json'));
        ctx.expect(root.devDependencies['@omega.js/liba']).toBe('file:omega_modules/omega.js-liba-1.0.0.tgz');
        ctx.expect(root.overrides['@omega.js/libb']).toBe('file:omega_modules/omega.js-libb-0.1.0.tgz');

        // The member's spec is relative to the MEMBER, never to the staged root
        const member = read(path.join(web, 'package.json'));
        ctx.expect(member.dependencies['@omega.js/liba']).toBe('file:../../omega_modules/omega.js-liba-1.0.0.tgz');
        ctx.expect(member.overrides, 'overrides belong to the install root only').toBe(undefined);

        const lock = read(path.join(brandRoot, 'package-lock.json'));
        ctx.expect(lock, 'the install root carries the regenerated lockfile').toBeTruthy();
        ctx.expect(lock.packages['node_modules/@omega.js/liba'].resolved).toBe('file:omega_modules/omega.js-liba-1.0.0.tgz');
        ctx.expect(lock.packages['node_modules/@omega.js/libb'].resolved).toBe('file:omega_modules/omega.js-libb-0.1.0.tgz');

        await staging.restore();
        ctx.expect(jetpack.read(path.join(brandRoot, 'package.json')), 'root manifest restored byte-for-byte').toBe(rootManifest);
        ctx.expect(jetpack.read(path.join(web, 'package.json')), 'member manifest restored byte-for-byte').toBe(memberManifest);
        ctx.expect(jetpack.exists(path.join(brandRoot, 'omega_modules')), 'staging dir removed').toBe(false);
        ctx.expect(jetpack.exists(path.join(brandRoot, 'package-lock.json')), 'lockfile absent again').toBe(false);

        jetpack.remove(tmp);
      },
    },

    {
      name: 'second hop: a member of an already-staged tree COPIES the tarballs and packs nothing',
      run: async (ctx) => {
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

        const web = path.join(snapshot, 'targets', 'web');
        const staging = await stageLocalPackages({ dir: web });

        ctx.expect(staging.staged).toEqual(['@omega.js/liba', '@omega.js/libb']);
        ctx.expect(jetpack.exists(path.join(web, 'omega_modules', 'omega.js-liba-1.0.0.tgz'))).toBe('file');
        ctx.expect(jetpack.exists(path.join(web, 'omega_modules', 'omega.js-libb-0.1.0.tgz')), 'the ROOT override travelled with the member').toBe('file');

        const member = read(path.join(web, 'package.json'));
        ctx.expect(member.dependencies['@omega.js/liba']).toBe('file:omega_modules/omega.js-liba-1.0.0.tgz');
        ctx.expect(member.overrides['@omega.js/libb']).toBe('file:omega_modules/omega.js-libb-0.1.0.tgz');

        const lock = read(path.join(web, 'package-lock.json'));
        ctx.expect(lock, 'the member is its own install root now').toBeTruthy();
        ctx.expect(lock.packages['node_modules/@omega.js/liba'].resolved).toBe('file:omega_modules/omega.js-liba-1.0.0.tgz');
        ctx.expect(lock.packages['node_modules/@omega.js/libb'].resolved).toBe('file:omega_modules/omega.js-libb-0.1.0.tgz');

        await staging.restore();
        ctx.expect(read(path.join(web, 'package.json')).dependencies['@omega.js/liba'], 'the first hop\'s spelling is back').toBe('file:../../omega_modules/omega.js-liba-1.0.0.tgz');
        ctx.expect(jetpack.exists(path.join(web, 'omega_modules')), 'staging dir removed').toBe(false);

        jetpack.remove(tmp);
      },
    },
  ],
});

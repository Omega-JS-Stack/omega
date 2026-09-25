/**
 * The brand's ONE version ([#869](https://github.com/Omega-JS-Stack/omega/issues/869)):
 * the brand root package.json is the master and every target follows it.
 * `omega bump` is the only writer; every framework's `omega deploy` refuses a
 * target whose number has drifted from the root's.
 *
 * What these tests hold it to:
 *   - a bump writes the root, EVERY target (one with no version gains one) and
 *     the brand lock's entries, at exact numbers;
 *   - a read changes no file, and a second read sees no drift;
 *   - the drift refusal names the target and the fix;
 *   - outside a brand there is nothing to compare, so the check is quiet;
 *   - a brand root with no version is a refusal naming the file and the fix.
 *
 * Real files in a throwaway tree: nothing here is stubbed.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readBrandVersion, listTargetPackages, bumpBrandVersion, assertBrandVersion, assertBrandLockfile } = require('../src/brand-version.js');

/**
 * A brand tree: the root (config + package.json), three targets, and the brand
 * lock npm writes beside them. `web` carries NO version, the shape a brand has
 * before its first bump.
 *
 * @param {object} [options] - { version } for the brand root (omitted = none).
 * @returns {string} The brand root.
 */
function makeBrand({ version = '0.0.2' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brand-version-')));

  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
  targets: { web: { type: 'web' }, desktop: { type: 'desktop' }, extension: { type: 'extension' } },
}
`);

  writeJson(path.join(root, 'package.json'), {
    name: 'fixture-brand',
    ...(version ? { version } : {}),
    private: true,
    workspaces: ['targets/*'],
  });

  writeJson(path.join(root, 'targets', 'desktop', 'package.json'), { name: 'fixture-desktop', version: '0.0.2', private: true });
  writeJson(path.join(root, 'targets', 'extension', 'package.json'), { name: 'fixture-extension', version: '0.0.2', private: true });
  // No version at all: the target gains one, because every target follows.
  writeJson(path.join(root, 'targets', 'web', 'package.json'), { name: 'fixture-website', private: true });

  writeJson(path.join(root, 'package-lock.json'), {
    name: 'fixture-brand',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture-brand', workspaces: ['targets/*'] },
      'targets/desktop': { name: 'fixture-desktop', version: '0.0.2' },
      'targets/extension': { name: 'fixture-extension', version: '0.0.2' },
      'targets/web': { name: 'fixture-website', license: 'UNLICENSED' },
      // A stale entry from a rename: not a target on disk, so nothing touches it.
      'targets/website': { name: 'fixture-website', version: '0.0.1', extraneous: true },
    },
  });

  return root;
}

function writeJson(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every version the tree carries, keyed by the path that carries it. */
function versions(root) {
  const lock = readJson(path.join(root, 'package-lock.json'));
  return {
    root: readJson(path.join(root, 'package.json')).version,
    desktop: readJson(path.join(root, 'targets', 'desktop', 'package.json')).version,
    extension: readJson(path.join(root, 'targets', 'extension', 'package.json')).version,
    web: readJson(path.join(root, 'targets', 'web', 'package.json')).version,
    lockDesktop: lock.packages['targets/desktop'].version,
    lockExtension: lock.packages['targets/extension'].version,
    lockWeb: lock.packages['targets/web'].version,
    lockStale: lock.packages['targets/website'].version,
  };
}

/** Capture the lines a run logs. */
function capture(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.map(String).join(' '));
  try {
    return { result: fn(), lines };
  } finally {
    console.log = original;
  }
}

test('readBrandVersion walks up to the brand root from anywhere inside it, and writes nothing', () => {
  const root = makeBrand();
  const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

  assert.deepStrictEqual(readBrandVersion({ dir: root }), { brandRoot: root, version: '0.0.2' });
  assert.deepStrictEqual(readBrandVersion({ dir: path.join(root, 'targets', 'desktop') }), { brandRoot: root, version: '0.0.2' }, 'a target resolves to its brand');

  assert.strictEqual(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before, 'a read is a read');

  fs.rmSync(root, { recursive: true, force: true });
});

test('readBrandVersion answers null outside a brand: a standalone target has no brand to follow', () => {
  const loose = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brand-version-loose-')));
  fs.writeFileSync(path.join(loose, 'package.json'), '{"name":"standalone","version":"1.2.3"}\n');

  assert.strictEqual(readBrandVersion({ dir: loose }), null);
  assert.strictEqual(assertBrandVersion({ dir: loose }), null, 'nothing to compare, so nothing to refuse');

  fs.rmSync(loose, { recursive: true, force: true });
});

test('a brand root with NO version is a refusal naming the file and the fix', () => {
  const root = makeBrand({ version: null });

  assert.throws(
    () => readBrandVersion({ dir: root }),
    (error) => {
      assert.strictEqual(error.refusal, true, 'a refusal prints its message alone');
      assert.match(error.message, /package\.json/, 'names the file');
      assert.match(error.message, /add "version"/, 'names the fix');
      assert.match(error.message, /omega bump/, 'and the verb that moves it from there');
      return true;
    },
  );

  // The deploy gate reads through the same rule, so an unseeded brand is loud
  // there too rather than deploying whatever each target happens to carry.
  assert.throws(() => assertBrandVersion({ dir: path.join(root, 'targets', 'desktop') }), /add "version"/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('listTargetPackages is every targets/<name> that carries a package.json', () => {
  const root = makeBrand();
  // A directory under targets/ with no manifest is not a target.
  fs.mkdirSync(path.join(root, 'targets', 'scratch'), { recursive: true });

  const targets = listTargetPackages({ brandRoot: root });

  assert.deepStrictEqual(targets.map((entry) => entry.name), ['desktop', 'extension', 'web'], 'named, sorted, manifest-carrying');
  assert.strictEqual(targets[0].manifest, path.join(root, 'targets', 'desktop', 'package.json'));

  fs.rmSync(root, { recursive: true, force: true });
});

test('bumpBrandVersion writes the root, EVERY target and the lock entries, and logs one line per file', () => {
  const root = makeBrand();
  const { result, lines } = capture(() => bumpBrandVersion({ brandRoot: root, kind: 'patch' }));

  assert.strictEqual(result.previous, '0.0.2');
  assert.strictEqual(result.next, '0.0.3');
  assert.deepStrictEqual(result.files, [
    'package.json',
    path.join('targets', 'desktop', 'package.json'),
    path.join('targets', 'extension', 'package.json'),
    path.join('targets', 'web', 'package.json'),
    'package-lock.json',
  ]);

  assert.deepStrictEqual(versions(root), {
    root: '0.0.3',
    desktop: '0.0.3',
    extension: '0.0.3',
    web: '0.0.3',
    lockDesktop: '0.0.3',
    lockExtension: '0.0.3',
    lockWeb: '0.0.3',
    lockStale: '0.0.1',
  }, 'one number everywhere the brand carries one; the stale lock entry is nobody\'s target');

  assert.strictEqual(lines.length, result.files.length, 'one line per file written');
  assert.match(lines[0], /\[@omega\.js\/devkit:brand-version\]/, 'the log-tag convention');
  assert.match(lines[0], /package\.json 0\.0\.2 -> 0\.0\.3/);
  assert.match(lines.join('\n'), /targets[\\/]web[\\/]package\.json \(none\) -> 0\.0\.3/, 'a target that had no version says so');

  // Written the way npm writes them: 2-space JSON, trailing newline, and the
  // gained key sits after `name` rather than at the end of the file.
  const raw = fs.readFileSync(path.join(root, 'targets', 'web', 'package.json'), 'utf8');
  assert.strictEqual(raw.endsWith('\n'), true);
  assert.match(raw, /"name": "fixture-website",\n {2}"version": "0\.0\.3"/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('minor and major move the right digit, and an unknown kind refuses naming the three', () => {
  const root = makeBrand({ version: '1.2.3' });

  capture(() => bumpBrandVersion({ brandRoot: root, kind: 'minor' }));
  assert.strictEqual(versions(root).root, '1.3.0', 'minor zeroes the patch');

  capture(() => bumpBrandVersion({ brandRoot: root, kind: 'major' }));
  assert.strictEqual(versions(root).root, '2.0.0', 'major zeroes both');

  assert.throws(() => bumpBrandVersion({ brandRoot: root, kind: 'build' }), /patch, minor, major/);
  assert.strictEqual(versions(root).root, '2.0.0', 'a refused kind writes nothing');

  fs.rmSync(root, { recursive: true, force: true });
});

test('a PRERELEASE root version is refused by name: this verb moves whole releases', () => {
  const root = makeBrand({ version: '1.0.0-beta.2' });

  assert.throws(
    () => bumpBrandVersion({ brandRoot: root, kind: 'patch' }),
    (error) => {
      assert.strictEqual(error.refusal, true);
      assert.match(error.message, /1\.0\.0-beta\.2/, 'names the version it will not move');
      assert.match(error.message, /prerelease/);
      return true;
    },
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test('after a bump nothing has drifted: the assert is quiet from every target', () => {
  const root = makeBrand();
  capture(() => bumpBrandVersion({ brandRoot: root, kind: 'patch' }));

  for (const name of ['desktop', 'extension', 'web']) {
    const { lines } = capture(() => assertBrandVersion({ dir: path.join(root, 'targets', name) }));
    assert.deepStrictEqual(lines, [], `${name}: a match says nothing`);
  }

  // And the read is stable: a second bump's `previous` is the first one's `next`.
  const second = capture(() => bumpBrandVersion({ brandRoot: root, kind: 'patch' }));
  assert.strictEqual(second.result.previous, '0.0.3');
  assert.strictEqual(second.result.next, '0.0.4');

  fs.rmSync(root, { recursive: true, force: true });
});

test('a DRIFTED target is refused, naming the target and `omega bump`', () => {
  const root = makeBrand({ version: '0.0.3' });

  assert.throws(
    () => assertBrandVersion({ dir: path.join(root, 'targets', 'desktop') }),
    (error) => {
      assert.strictEqual(error.refusal, true, 'a refusal prints its message alone');
      assert.match(error.message, /targets\/desktop is 0\.0\.2 but the brand is 0\.0\.3/);
      assert.match(error.message, /omega bump/, 'names the fix');
      return true;
    },
  );

  // A target with no version at all is drift too, said in its own words.
  assert.throws(() => assertBrandVersion({ dir: path.join(root, 'targets', 'web') }), /targets\/web has no version but the brand is 0\.0\.3/);

  // The brand ROOT itself is not a target: there is nothing to compare there.
  assert.strictEqual(assertBrandVersion({ dir: root }), null);

  fs.rmSync(root, { recursive: true, force: true });
});

// ---- The lockfile gate (#938): the registry lane ships the brand's OWN lock,
// and the runner's `npm ci` installs exactly what it says.

/**
 * A registry-spec brand: the root declares the manager, `targets/web` the web
 * framework, `targets/desktop` nothing of the family. `lock` is the brand lock
 * as written, or null for none at all.
 *
 * @param {object|null} lock - The package-lock.json content.
 * @returns {string} The brand root.
 */
function makeRegistryBrand(lock) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brand-lockfile-')));

  writeJson(path.join(root, 'package.json'), {
    name: 'fixture-brand', version: '0.51.0', private: true, workspaces: ['targets/*'],
    devDependencies: { '@omega.js/manager': '0.51.0' },
  });
  writeJson(path.join(root, 'targets', 'web', 'package.json'), {
    name: 'fixture-website', version: '0.51.0', dependencies: { '@omega.js/web': '0.51.0', lodash: '^4.17.0' },
  });
  writeJson(path.join(root, 'targets', 'desktop', 'package.json'), { name: 'fixture-desktop', version: '0.51.0' });

  if (lock) writeJson(path.join(root, 'package-lock.json'), lock);

  return root;
}

/** A lock whose two @omega.js entries are the given ones. */
function lockWith(manager, web) {
  return {
    name: 'fixture-brand',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture-brand', version: '0.51.0', devDependencies: { '@omega.js/manager': '0.51.0' } },
      'node_modules/@omega.js/manager': manager,
      'node_modules/@omega.js/web': web,
      'node_modules/lodash': { version: '4.17.21', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz' },
    },
  };
}

const REGISTRY_MANAGER = { version: '0.51.0', resolved: 'https://registry.npmjs.org/@omega.js/manager/-/manager-0.51.0.tgz', dev: true };
const REGISTRY_WEB = { version: '0.51.0', resolved: 'https://registry.npmjs.org/@omega.js/web/-/web-0.51.0.tgz' };

test('#938: a lock that matches the manifests at registry versions passes the gate', () => {
  const root = makeRegistryBrand(lockWith(REGISTRY_MANAGER, REGISTRY_WEB));

  assert.doesNotThrow(() => assertBrandLockfile({ root }));

  fs.rmSync(root, { recursive: true, force: true });
});

test('#938: a copy npm NESTED under the target counts, the hoisted slot is not the only one', () => {
  const lock = lockWith(REGISTRY_MANAGER, { resolved: '../../packages/web', link: true });
  lock.packages['targets/web/node_modules/@omega.js/web'] = REGISTRY_WEB;
  const root = makeRegistryBrand(lock);

  assert.doesNotThrow(() => assertBrandLockfile({ root }));

  fs.rmSync(root, { recursive: true, force: true });
});

test('#938: a lock still carrying the local era\'s LINK entries is refused, naming each and `omega i live`', () => {
  const root = makeRegistryBrand(lockWith(
    { resolved: '../../packages/manager', link: true },
    { resolved: '../../packages/web', link: true },
  ));

  assert.throws(
    () => assertBrandLockfile({ root }),
    (error) => {
      assert.strictEqual(error.refusal, true, 'a refusal prints its message alone');
      assert.match(error.message, /package\.json: @omega\.js\/manager 0\.51\.0 is locked as a link to \.\.\/\.\.\/packages\/manager/);
      assert.match(error.message, /targets\/web: @omega\.js\/web 0\.51\.0 is locked as a link to \.\.\/\.\.\/packages\/web/);
      assert.match(error.message, /omega i live/, 'names the fix');
      return true;
    },
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test('#938: a lock at 0.50.0 for a 0.51.0 spec is refused, naming the locked version', () => {
  const root = makeRegistryBrand(lockWith(
    REGISTRY_MANAGER,
    { version: '0.50.0', resolved: 'https://registry.npmjs.org/@omega.js/web/-/web-0.50.0.tgz' },
  ));

  assert.throws(
    () => assertBrandLockfile({ root }),
    (error) => {
      assert.match(error.message, /targets\/web: @omega\.js\/web 0\.51\.0 is locked at 0\.50\.0/);
      assert.doesNotMatch(error.message, /@omega\.js\/manager/, 'the entry that agrees is not named');
      assert.match(error.message, /omega i live/);
      return true;
    },
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test('#938: a PATH resolved entry (a packed tarball) and an ABSENT entry are refused too', () => {
  const lock = lockWith(REGISTRY_MANAGER, { version: '0.51.0', resolved: 'file:omega_modules/omega.js-web-0.51.0.tgz' });
  const root = makeRegistryBrand(lock);

  assert.throws(() => assertBrandLockfile({ root }), /@omega\.js\/web 0\.51\.0 is locked at the path file:omega_modules\/omega\.js-web-0\.51\.0\.tgz/);

  delete lock.packages['node_modules/@omega.js/manager'];
  writeJson(path.join(root, 'package-lock.json'), lock);
  assert.throws(() => assertBrandLockfile({ root }), /package\.json: @omega\.js\/manager 0\.51\.0 is not in the lock/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('#938: a brand with NO lockfile is refused the same way', () => {
  const root = makeRegistryBrand(null);

  assert.throws(
    () => assertBrandLockfile({ root }),
    (error) => {
      assert.strictEqual(error.refusal, true);
      assert.match(error.message, /has no package-lock\.json/);
      assert.match(error.message, /omega i live/);
      return true;
    },
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test('#938: a STALE workspace entry (a folder no longer on disk) declaring an @omega.js file: spec is refused, with or without its link', () => {
  const lock = lockWith(REGISTRY_MANAGER, REGISTRY_WEB);
  lock.packages['targets/website'] = { name: 'fixture-website', extraneous: true, dependencies: { '@omega.js/web': 'file:../../../../packages/web' } };
  const root = makeRegistryBrand(lock);

  assert.throws(
    () => assertBrandLockfile({ root }),
    (error) => {
      assert.match(error.message, /targets\/website: @omega\.js\/web file:\.\.\/\.\.\/\.\.\/\.\.\/packages\/web is declared by a stale lock entry \(targets\/website is not on disk\)/);
      assert.match(error.message, /omega i live/);
      return true;
    },
  );

  // The shape `omega i live` met: the stale entry re-created the link, which is refused on its own too.
  lock.packages['node_modules/@omega.js/web'] = { resolved: '../../packages/web', link: true };
  writeJson(path.join(root, 'package-lock.json'), lock);
  assert.throws(() => assertBrandLockfile({ root }), /targets\/web: @omega\.js\/web 0\.51\.0 is locked as a link to \.\.\/\.\.\/packages\/web/);

  // A stale entry declaring only registry specs is not the gate's business.
  lock.packages['node_modules/@omega.js/web'] = REGISTRY_WEB;
  lock.packages['targets/website'].dependencies = { '@omega.js/web': '0.51.0' };
  writeJson(path.join(root, 'package-lock.json'), lock);
  assert.doesNotThrow(() => assertBrandLockfile({ root }));

  fs.rmSync(root, { recursive: true, force: true });
});

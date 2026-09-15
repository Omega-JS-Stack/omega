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

const { readBrandVersion, listTargetPackages, bumpBrandVersion, assertBrandVersion } = require('../src/brand-version.js');

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

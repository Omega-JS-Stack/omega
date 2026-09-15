/**
 * Brand-root `omega bump` ([#869](https://github.com/Omega-JS-Stack/omega/issues/869)):
 * the brand root package.json `version` is the master and every target follows
 * it, so ONE verb writes them together.
 *
 * What these tests hold it to:
 *   - a bare run REPORTS the brand's version and writes nothing;
 *   - `patch` moves the root, every target and the brand lock, at exact numbers;
 *   - an unknown token is refused naming the three kinds, writing nothing;
 *   - outside a brand the verb refuses rather than bumping the nearest manifest.
 *
 * Real files on disk, run through the real command: nothing is stubbed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677).
require('./lib/temp-home.js');

const bumpCommand = require('../src/commands/bump.js');

/** A brand with two targets and the lock npm writes beside them. */
function stageBrand({ version = '0.1.0' } = {}) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-bump-')));
  const brand = path.join(scratch, 'brand');

  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' }, desktop: { type: 'desktop' } },
}
`);

  write(path.join(brand, 'package.json'), { name: 'fixture-brand', version, private: true, workspaces: ['targets/*'] });
  write(path.join(brand, 'targets', 'web', 'package.json'), { name: 'fixture-web', version, private: true });
  write(path.join(brand, 'targets', 'desktop', 'package.json'), { name: 'fixture-desktop', version, private: true });
  write(path.join(brand, 'package-lock.json'), {
    name: 'fixture-brand',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture-brand', workspaces: ['targets/*'] },
      'targets/web': { name: 'fixture-web', version },
      'targets/desktop': { name: 'fixture-desktop', version },
    },
  });

  return brand;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
}

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every version in the tree: root, each target, each lock entry. */
function versions(brand) {
  const lock = read(path.join(brand, 'package-lock.json'));
  return {
    root: read(path.join(brand, 'package.json')).version,
    web: read(path.join(brand, 'targets', 'web', 'package.json')).version,
    desktop: read(path.join(brand, 'targets', 'desktop', 'package.json')).version,
    lockWeb: lock.packages['targets/web'].version,
    lockDesktop: lock.packages['targets/desktop'].version,
  };
}

/** Run the command from `cwd` with console captured, restoring cwd + exitCode. */
async function runBump(cwd, ...tokens) {
  const cwd0 = process.cwd();
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => lines.push(args.map(String).join(' '));
  console.error = (...args) => lines.push(args.map(String).join(' '));
  process.chdir(cwd);

  try {
    await bumpCommand({ _: ['bump', ...tokens] });
    return { text: lines.join('\n'), code: process.exitCode };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

test('a bare run prints the brand and its version, and writes nothing', async () => {
  const brand = stageBrand();
  const before = fs.readFileSync(path.join(brand, 'package.json'), 'utf8');

  const { text, code } = await runBump(brand);

  assert.equal(text.trim(), 'fixture-brand v0.1.0', 'the brand id and the one version, nothing else');
  assert.equal(code, undefined, 'a report exits clean');
  assert.equal(fs.readFileSync(path.join(brand, 'package.json'), 'utf8'), before, 'a bare run is a read');
});

test('`patch` moves the root AND every target AND the lock, together', async () => {
  const brand = stageBrand();

  const { text, code } = await runBump(brand, 'patch');

  assert.deepEqual(versions(brand), {
    root: '0.1.1', web: '0.1.1', desktop: '0.1.1', lockWeb: '0.1.1', lockDesktop: '0.1.1',
  }, 'the root is the master and every target followed it');
  assert.equal(code, undefined);

  assert.match(text, /0\.1\.0 -> 0\.1\.1/, 'the summary names both numbers');
  assert.match(text, /targets[\\/]desktop[\\/]package\.json 0\.1\.0 -> 0\.1\.1/, 'one line per file written');
  assert.match(text, /chore\(release\)/, 'and says the commit is still the ship flow\'s');

  // It is a VERSION verb, not a release verb: nothing is committed or tagged.
  assert.equal(fs.existsSync(path.join(brand, '.git')), false);
});

test('minor and major are the other two kinds, and an unknown token is refused naming all three', async () => {
  const brand = stageBrand();

  await runBump(brand, 'minor');
  assert.equal(versions(brand).root, '0.2.0');

  await runBump(brand, 'major');
  assert.equal(versions(brand).desktop, '1.0.0', 'every target followed the major too');

  const { text, code } = await runBump(brand, 'v2');
  assert.match(text, /Unknown bump "v2"/);
  assert.match(text, /patch, minor, major/, 'the error names what the verb does take');
  assert.equal(code, 1);
  assert.equal(versions(brand).root, '1.0.0', 'a refused token writes nothing');
});

test('outside a brand it refuses: there is no nearest manifest to bump instead', async () => {
  const loose = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-bump-loose-')));
  fs.writeFileSync(path.join(loose, 'package.json'), '{"name":"standalone","version":"1.2.3"}\n');

  const { text, code } = await runBump(loose, 'patch');

  assert.match(text, /Not inside a brand monorepo/);
  assert.match(text, /omega bump` at the brand root/, 'the error names where the verb belongs');
  assert.equal(code, 1);
  assert.equal(read(path.join(loose, 'package.json')).version, '1.2.3', 'the standalone manifest is untouched');
});

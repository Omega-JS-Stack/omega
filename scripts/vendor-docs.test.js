/**
 * Shipped-docs structure test: @omega.js/manager, the package every brand
 * installs, carries the whole docs tree and the one-line AGENTS.md that imports
 * its map, and no copy of the Claude plugin: a machine gets that from GitHub.
 * No other publishable ships docs.
 *
 * Each package is REALLY packed (`npm pack` into a temp dir, running its own
 * prepare and so the devkit vendor lane) and the tarball listing is asserted.
 *
 * Run: node --test scripts/vendor-docs.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { HOST_PACKAGE, MAP_FILE } = require(path.join(ROOT, 'packages', 'devkit', 'tools', 'vendor-docs.js'));
const { PUBLISHABLES } = require('./release-check.js');

// One pack per package is the expensive part: pack once, share the listing.
const listings = new Map();

/**
 * Pack a package for real and return its tarball's file list (package/-relative).
 * @param {string} short - Package short name ('web', 'manager', ...)
 * @returns {string[]}
 */
function packedFiles(short) {
  if (listings.has(short)) {
    return listings.get(short);
  }

  const cwd = path.join(ROOT, 'packages', short);
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), `omega-pack-${short}-`));
  const pack = spawnSync('npm', ['pack', '--pack-destination', destination], { cwd, encoding: 'utf8' });
  assert.equal(pack.status, 0, `npm pack failed for ${short}:\n${pack.stdout}${pack.stderr}`);

  const tarball = fs.readdirSync(destination).find((file) => file.endsWith('.tgz'));
  assert.ok(tarball, `npm pack produced no tarball for ${short}`);

  const list = spawnSync('tar', ['-tzf', path.join(destination, tarball)], { encoding: 'utf8' });
  assert.equal(list.status, 0, `tar listing failed for ${short}: ${list.stderr}`);

  const files = list.stdout.split('\n').filter(Boolean).map((entry) => entry.replace(/^package\//, ''));
  fs.rmSync(destination, { recursive: true, force: true });
  listings.set(short, files);
  return files;
}

test('vendor-docs: the manager ships AGENTS.md and the map it imports, inside the whole docs tree', () => {
  const files = packedFiles(HOST_PACKAGE);
  const agents = fs.readFileSync(path.join(ROOT, 'packages', HOST_PACKAGE, 'AGENTS.md'), 'utf8').trim();

  assert.ok(files.includes('AGENTS.md'), 'the one-line AGENTS.md ships');
  assert.ok(files.includes(agents.slice(1)), `the file it imports (${agents}) ships beside it`);
  assert.equal(agents.slice(1), MAP_FILE.split(path.sep).join('/'));

  const sourceDocs = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'docs'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const missing = sourceDocs.filter((file) => !files.includes(file));
  assert.deepEqual(missing, [], 'every doc ships at the same path');
});

test('case 13: the packed manager holds no claude-plugin/ and no .claude-plugin/, and still holds docs/', () => {
  const files = packedFiles(HOST_PACKAGE);

  assert.deepEqual(files.filter((file) => file.startsWith('claude-plugin/')), [], 'no vendored plugin');
  assert.deepEqual(files.filter((file) => file.startsWith('.claude-plugin/')), [], 'no package-root marketplace');
  assert.ok(files.includes('docs/omega.md'), 'the docs tree still ships');
  assert.ok(files.filter((file) => file.startsWith('docs/')).length > 10, 'the whole docs tree, not a stub');
});

for (const short of PUBLISHABLES.filter((name) => name !== HOST_PACKAGE)) {
  test(`vendor-docs: @omega.js/${short} ships no docs`, () => {
    assert.deepEqual(packedFiles(short).filter((file) => file.startsWith('docs/')), []);
  });
}

test('vendor-docs: everything the lane writes is generated: gitignored, never a committed file', () => {
  packedFiles(HOST_PACKAGE);
  const status = spawnSync('git', ['status', '--porcelain', '--', `packages/${HOST_PACKAGE}/docs`], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(status.status, 0, `git status failed: ${status.stderr}`);
  assert.equal(status.stdout.trim(), '', 'vendored docs must be gitignored and never a committed file');
});

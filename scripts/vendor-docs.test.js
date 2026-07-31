/**
 * Shipped-docs structure test — every publishable carries version-matched
 * knowledge ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)).
 *
 * Each package is REALLY packed (`npm pack` into a temp dir, running its own
 * prepare → the devkit vendor lane) and the tarball listing is asserted: the
 * package's own guide at `docs/index.md`, the shared contracts under
 * `docs/shared/`, and — for @omega.js/manager, the package every brand
 * installs — the Claude plugin plus the package-root marketplace that a brand's
 * `.claude/settings.json` points at
 * ([#62](https://github.com/Omega-JS-Stack/omega/issues/62)).
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
const { DOCUMENTED_PACKAGES } = require(path.join(ROOT, 'packages', 'devkit', 'tools', 'vendor-docs.js'));

// One pack per package is the expensive part — pack once, share the listing.
const listings = new Map();

/**
 * Pack a package for real and return its tarball's file list (package/-relative).
 * @param {string} short - Package short name ('web', 'manager', …)
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

for (const short of DOCUMENTED_PACKAGES) {
  test(`vendor-docs: @omega.js/${short} ships its guide and the shared contracts`, () => {
    const files = packedFiles(short);

    assert.ok(files.includes('docs/index.md'), `${short}: the package guide must ship as docs/index.md`);
    assert.ok(
      files.some((file) => file.startsWith('docs/shared/') && file.endsWith('.md')),
      `${short}: the shared contracts must ship under docs/shared/`
    );
  });
}

test('vendor-docs: @omega.js/manager also ships the Claude plugin and its marketplace', () => {
  const files = packedFiles('manager');

  assert.ok(files.includes('.claude-plugin/marketplace.json'), 'the package-root marketplace must ship');
  assert.ok(files.includes('claude-plugin/.claude-plugin/plugin.json'), 'the plugin manifest must ship');
  assert.ok(
    files.some((file) => file.startsWith('claude-plugin/skills/') && file.endsWith('SKILL.md')),
    'the plugin skills must ship'
  );
  assert.ok(
    files.some((file) => file.startsWith('claude-plugin/hooks/')),
    'the plugin hooks must ship'
  );

  // The MCP server addresses a path OUTSIDE the plugin (the monorepo's
  // packages/mcp-router), which no consumer install has — the vendored copy
  // ships without it rather than failing to start it every session (#144).
  assert.ok(
    !files.includes('claude-plugin/.mcp.json'),
    'the vendored plugin must not carry the monorepo-only MCP server declaration'
  );
});

test('vendor-docs: everything the lane writes is generated — gitignored, never a committed file', () => {
  // Scoped to the paths the lane writes: unrelated work in progress elsewhere
  // in the tree is not this test's business.
  const paths = [];
  for (const short of DOCUMENTED_PACKAGES) {
    packedFiles(short);
    paths.push(`packages/${short}/docs`, `packages/${short}/claude-plugin`, `packages/${short}/.claude-plugin`);
  }

  const status = spawnSync('git', ['status', '--porcelain', '--', ...paths], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(status.status, 0, `git status failed: ${status.stderr}`);
  assert.equal(status.stdout.trim(), '', 'vendored docs/plugin output must be gitignored and must never clobber a committed doc');
});

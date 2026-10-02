// Unit tests for tools/vendor-docs.js, the prepare-time docs lane: the
// monorepo's whole docs/ tree lands in @omega.js/manager (and nowhere else)
// with its outbound links retargeted. The Claude plugin never ships in the
// manager: it reaches a machine from GitHub. syncDocs writes only what changed.
//
// Fixtures build a miniature monorepo under packages/devkit/.temp/ (gitignored)
// and vendor from it via the monorepoRoot seam, never the real docs tree.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vendorDocs = require('../tools/vendor-docs');

const { syncDocs } = vendorDocs;
const TEMP_ROOT = path.join(__dirname, '..', '.temp');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

// A miniature monorepo: docs/ with the map, a shared contract, a framework
// guide with a nested folder and a binary file, the plugin tree, the root
// marketplace, and the manager and web package dirs.
function makeFixture(label) {
  const root = path.join(TEMP_ROOT, `${label}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  const write = (relative, contents) => {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };

  write('package.json', JSON.stringify({ name: 'omega', workspaces: ['packages/*'] }));
  write('docs/omega.md', [
    '# OMEGA',
    'Contract: [config.md](shared/config.md)',
    'Guide: [web](web/index.md#top)',
    'Source: [packages/account/src](../packages/account/src)',
    'Plugin: [main skill](../agent-plugins/claude/skills/main/SKILL.md)',
    'Brand: [sandbox](../brands/sandbox-brand)',
    'Remote: [github](https://github.com/Omega-JS-Stack/omega)',
    'Here: [below](#below)',
    '',
  ].join('\n'));
  write('docs/shared/config.md', '# config\n');
  write('docs/web/index.md', 'Long form: [README.md](../../packages/web/README.md#usage)\nMap: [omega](../omega.md)\n');
  write('docs/web/classy-v2/DIRECTION.md', '# direction\n');
  write('docs/web/classy-v2/shot.png', PNG);
  write('agent-plugins/claude/.claude-plugin/plugin.json', JSON.stringify({ name: 'omega', version: '0.1.0' }));
  write('agent-plugins/claude/.mcp.json', JSON.stringify({
    mcpServers: { 'mcp-router': { args: ['${CLAUDE_PLUGIN_ROOT}/mcp-router-launch.js'] } },
  }));
  write('agent-plugins/claude/mcp-router-launch.js', '// launcher\n');
  write('agent-plugins/claude/skills/main/SKILL.md', '---\nname: main\n---\n');
  write('.claude-plugin/marketplace.json', JSON.stringify({
    name: 'omega',
    owner: { name: 'ITW Creative Works' },
    plugins: [{ name: 'omega', source: './agent-plugins/claude', description: 'OMEGA knowledge' }],
  }));
  write('packages/devkit/package.json', JSON.stringify({ name: '@omega.js/devkit' }));
  write('packages/manager/package.json', JSON.stringify({ name: '@omega.js/manager', version: '0.1.0' }));
  write('packages/web/package.json', JSON.stringify({ name: '@omega.js/web', version: '0.1.0' }));

  return { root, manager: path.join(root, 'packages', 'manager'), web: path.join(root, 'packages', 'web') };
}

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

test('vendor-docs: only the manager carries docs; any other package is a no-op', (t) => {
  const { root, web } = makeFixture('vendor-docs-other');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(vendorDocs({ cwd: web, monorepoRoot: root }), { docs: [], removed: [] });
  assert.equal(fs.existsSync(path.join(web, 'docs')), false);
});

test('vendor-docs: the whole docs tree lands in the manager with the same shape', (t) => {
  const { root, manager } = makeFixture('vendor-docs-tree');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = vendorDocs({ cwd: manager, monorepoRoot: root });

  assert.deepEqual([...result.docs].sort(), [
    'omega.md', 'shared/config.md', 'web/classy-v2/DIRECTION.md', 'web/classy-v2/shot.png', 'web/index.md',
  ]);
  assert.equal(read(manager, 'docs', 'shared', 'config.md'), '# config\n');
  assert.ok(fs.readFileSync(path.join(manager, 'docs', 'web', 'classy-v2', 'shot.png')).equals(PNG), 'binary files copy byte for byte');
});

test('vendor-docs: links inside docs keep their shape, links out of it are retargeted', (t) => {
  const { root, manager } = makeFixture('vendor-docs-links');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  vendorDocs({ cwd: manager, monorepoRoot: root });

  const map = read(manager, 'docs', 'omega.md');
  assert.match(map, /\]\(shared\/config\.md\)/, 'a link inside docs is untouched');
  assert.match(map, /\]\(web\/index\.md#top\)/, 'its anchor too');
  assert.match(map, /\]\(\.\.\/\.\.\/account\/src\)/, 'a package source link reaches the sibling in the scope');
  assert.match(map, /^Plugin: main skill$/m, 'the plugin does not ship, so a link into it keeps its words only');
  assert.match(map, /^Brand: sandbox$/m, 'a link with no shipped target keeps its words only');
  assert.match(map, /\]\(https:\/\/github\.com\/Omega-JS-Stack\/omega\)/, 'a web link is untouched');
  assert.match(map, /\]\(#below\)/, 'a same-page anchor is untouched');

  const guide = read(manager, 'docs', 'web', 'index.md');
  assert.match(guide, /\]\(\.\.\/\.\.\/\.\.\/web\/README\.md#usage\)/, 'depth is counted from the nested file');
  assert.match(guide, /\]\(\.\.\/omega\.md\)/);
  assert.ok(read(root, 'docs', 'omega.md').includes('](../packages/account/src)'), 'the monorepo source is never touched');
});

test('syncDocs: a re-run writes only what changed and removes what the source dropped', (t) => {
  const { root, manager } = makeFixture('vendor-docs-sync');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  syncDocs({ monorepoRoot: root, packageDir: manager });
  const untouched = path.join(manager, 'docs', 'shared', 'config.md');
  const past = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(untouched, past, past);
  fs.writeFileSync(path.join(manager, 'docs', 'AGENTS.md'), '# a stale shipped file\n');

  assert.deepEqual(syncDocs({ monorepoRoot: root, packageDir: manager }), { written: [], removed: ['AGENTS.md'] });
  assert.equal(fs.existsSync(path.join(manager, 'docs', 'AGENTS.md')), false, 'a file the source lacks is removed');

  fs.writeFileSync(path.join(root, 'docs', 'omega.md'), '# OMEGA v2\n');
  fs.rmSync(path.join(root, 'docs', 'web', 'classy-v2'), { recursive: true });

  const result = syncDocs({ monorepoRoot: root, packageDir: manager });
  assert.deepEqual(result.written, ['omega.md'], 'only the edited file is written');
  assert.deepEqual([...result.removed].sort(), ['web/classy-v2/DIRECTION.md', 'web/classy-v2/shot.png']);
  assert.equal(read(manager, 'docs', 'omega.md'), '# OMEGA v2\n');
  assert.equal(fs.existsSync(path.join(manager, 'docs', 'web', 'classy-v2')), false, 'the emptied folder is pruned');
  assert.equal(fs.statSync(untouched).mtime.getTime(), past.getTime(), 'an unchanged file is never rewritten');
});

test('syncDocs: a dry run reports the same changes and writes nothing', (t) => {
  const { root, manager } = makeFixture('vendor-docs-dry');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = syncDocs({ monorepoRoot: root, packageDir: manager, dryRun: true });
  assert.equal(result.written.length, 5);
  assert.equal(fs.existsSync(path.join(manager, 'docs')), false);
});

test('syncDocs: a missing docs source fails loudly', (t) => {
  const { root, manager } = makeFixture('vendor-docs-missing');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.rmSync(path.join(root, 'docs'), { recursive: true });
  assert.throws(() => vendorDocs({ cwd: manager, monorepoRoot: root }), /Missing docs source/);
});

test('vendor-docs: the manager carries no plugin and no marketplace, though the monorepo has both', (t) => {
  const { root, manager } = makeFixture('vendor-docs-plugin');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  vendorDocs({ cwd: manager, monorepoRoot: root });

  assert.equal(fs.existsSync(path.join(manager, 'claude-plugin')), false);
  assert.equal(fs.existsSync(path.join(manager, '.claude-plugin')), false);
  for (const gone of ['PLUGIN_SOURCE', 'PLUGIN_DIR', 'MARKETPLACE_FILE']) {
    assert.equal(vendorDocs[gone], undefined, `${gone} named the vendored plugin, which is gone`);
  }
});

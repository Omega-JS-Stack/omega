// Unit tests for tools/vendor-docs.js — the prepare-time docs lane
// ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)): the monorepo's
// guide tree for a package plus docs/shared/ are copied INTO the package so a
// published install carries version-matched knowledge, and @omega.js/manager
// additionally carries the Claude plugin + a package-root marketplace.
//
// Fixtures build a miniature monorepo under packages/devkit/.temp/ (gitignored)
// and vendor from it via the monorepoRoot seam — never the real docs tree.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vendorDocs = require('../tools/vendor-docs');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// A miniature monorepo: docs/<framework>/, docs/shared/, the plugin tree, the
// root marketplace, and a host package dir for `name`.
function makeFixture(label, name, { extraGuideFiles = {}, hostFiles = {} } = {}) {
  const root = path.join(TEMP_ROOT, `${label}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });

  const short = name.slice('@omega.js/'.length);
  const write = (relative, contents) => {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };

  write('package.json', JSON.stringify({ name: 'omega', workspaces: ['packages/*'] }, null, 2));
  write('packages/devkit/package.json', JSON.stringify({ name: '@omega.js/devkit' }, null, 2));
  write(`docs/${short}/index.md`, [
    `# ${name} guide`,
    '',
    `Deep: [docs/architecture.md](../../packages/${short}/docs/architecture.md)`,
    `Long form: [README.md](../../packages/${short}/README.md)`,
    'Contract: [config.md](../shared/config.md)',
    'Sibling framework: [backend](../backend/index.md)',
    '',
  ].join('\n'));
  for (const [relative, contents] of Object.entries(extraGuideFiles)) {
    write(`docs/${short}/${relative}`, contents);
  }
  write('docs/shared/config.md', '# config\n');
  write('docs/shared/testing.md', '# testing\n');
  write('agent-plugins/claude/.claude-plugin/plugin.json', JSON.stringify({ name: 'omega', version: '0.1.0' }, null, 2));
  write('agent-plugins/claude/.mcp.json', JSON.stringify({
    mcpServers: { 'mcp-router': { args: ['${CLAUDE_PLUGIN_ROOT}/../../packages/mcp-router/bin/mcp-router.js'] } },
  }, null, 2));
  write('agent-plugins/claude/skills/main/SKILL.md', '---\nname: main\n---\n');
  write('.claude-plugin/marketplace.json', JSON.stringify({
    name: 'omega',
    owner: { name: 'ITW Creative Works' },
    plugins: [{ name: 'omega', source: './agent-plugins/claude', description: 'OMEGA knowledge' }],
  }, null, 2));

  const host = path.join(root, 'packages', short);
  fs.mkdirSync(host, { recursive: true });
  fs.writeFileSync(path.join(host, 'package.json'), JSON.stringify({ name, version: '0.1.0' }, null, 2));
  for (const [relative, contents] of Object.entries(hostFiles)) {
    write(path.join('packages', short, relative), contents);
  }

  return { root, host };
}

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

test('vendor-docs: the guide lands beside the package docs and shared docs come with it', (t) => {
  const { root, host } = makeFixture('vendor-docs-web', '@omega.js/web', {
    extraGuideFiles: { 'sections.md': '# sections\n', 'classy-v2/DIRECTION.md': '# direction\n' },
    hostFiles: { 'docs/test-framework.md': '# committed package doc\n' },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = vendorDocs({ cwd: host, monorepoRoot: root });

  assert.ok(fs.existsSync(path.join(host, 'docs', 'index.md')), 'the guide ships as docs/index.md');
  assert.ok(fs.existsSync(path.join(host, 'docs', 'sections.md')), 'the rest of the guide tree ships flat beside it');
  assert.ok(fs.existsSync(path.join(host, 'docs', 'classy-v2', 'DIRECTION.md')), 'nested guide dirs survive');
  assert.ok(fs.existsSync(path.join(host, 'docs', 'shared', 'config.md')), 'shared contracts ship under docs/shared/');
  assert.ok(fs.existsSync(path.join(host, 'docs', 'shared', 'testing.md')));
  assert.equal(read(host, 'docs', 'test-framework.md'), '# committed package doc\n', 'the package\'s own docs are untouched');
  assert.ok(result.docs.includes('docs/index.md'));
  assert.equal(result.plugin, false, 'only the manager package carries the plugin');
});

test('vendor-docs: guide links are rewritten to the shipped layout', (t) => {
  const { root, host } = makeFixture('vendor-docs-links', '@omega.js/web');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  vendorDocs({ cwd: host, monorepoRoot: root });

  const guide = read(host, 'docs', 'index.md');
  assert.match(guide, /\]\(\.\.\/docs\/architecture\.md\)/, 'package deep docs resolve beside the shipped guide');
  assert.match(guide, /\]\(\.\.\/README\.md\)/, 'the package README is one level up');
  assert.match(guide, /\]\(shared\/config\.md\)/, 'shared contracts resolve under docs/shared/');
  assert.ok(!guide.includes('../../packages/web/'), 'no monorepo-relative paths survive in the guide');
});

test('vendor-docs: re-running is idempotent and clears stale output', (t) => {
  const { root, host } = makeFixture('vendor-docs-idempotent', '@omega.js/backend');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  vendorDocs({ cwd: host, monorepoRoot: root });
  const first = read(host, 'docs', 'index.md');

  fs.writeFileSync(path.join(root, 'docs', 'shared', 'testing.md'), '# testing v2\n');
  fs.rmSync(path.join(root, 'docs', 'shared', 'config.md'));

  vendorDocs({ cwd: host, monorepoRoot: root });
  assert.equal(read(host, 'docs', 'index.md'), first, 'unchanged sources produce identical output');
  assert.equal(read(host, 'docs', 'shared', 'testing.md'), '# testing v2\n', 'edits propagate');
  assert.ok(!fs.existsSync(path.join(host, 'docs', 'shared', 'config.md')), 'a removed shared doc leaves no stale copy');
});

test('vendor-docs: the manager package also carries the plugin and a package-root marketplace', (t) => {
  const { root, host } = makeFixture('vendor-docs-manager', '@omega.js/manager');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = vendorDocs({ cwd: host, monorepoRoot: root });

  assert.equal(result.plugin, true);
  assert.ok(fs.existsSync(path.join(host, 'claude-plugin', '.claude-plugin', 'plugin.json')), 'the plugin manifest ships');
  assert.ok(fs.existsSync(path.join(host, 'claude-plugin', 'skills', 'main', 'SKILL.md')), 'the skills ship with it');
  assert.ok(
    !fs.existsSync(path.join(host, 'claude-plugin', '.mcp.json')),
    'the MCP declaration addresses the monorepo tree — it never ships to a consumer (#144)'
  );
  assert.ok(fs.existsSync(path.join(root, 'agent-plugins', 'claude', '.mcp.json')), 'the live monorepo plugin keeps its own');

  const marketplace = JSON.parse(read(host, '.claude-plugin', 'marketplace.json'));
  assert.equal(marketplace.name, 'omega', 'the root marketplace is the SSOT for name/owner');
  assert.equal(marketplace.owner.name, 'ITW Creative Works');
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].source, './claude-plugin', 'the source points inside the package (must start with ./)');
  assert.ok(!JSON.stringify(marketplace).includes('..'), 'a marketplace source can never escape the package');
});

test('vendor-docs: a package with no guide tree is skipped, a missing guide fails loudly', (t) => {
  const { root, host } = makeFixture('vendor-docs-skip', '@omega.js/devkit');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = vendorDocs({ cwd: path.join(root, 'packages', 'devkit'), monorepoRoot: root });
  assert.deepEqual(result, { docs: [], plugin: false }, 'private packages never ship docs');
  assert.ok(!fs.existsSync(path.join(root, 'packages', 'devkit', 'docs')));
  assert.ok(fs.existsSync(host), 'fixture sanity');

  fs.rmSync(path.join(root, 'docs', 'shared'), { recursive: true, force: true });
  const { host: webHost } = { host: path.join(root, 'packages', 'web') };
  fs.mkdirSync(webHost, { recursive: true });
  fs.writeFileSync(path.join(webHost, 'package.json'), JSON.stringify({ name: '@omega.js/web' }));
  assert.throws(() => vendorDocs({ cwd: webHost, monorepoRoot: root }), /docs/);
});

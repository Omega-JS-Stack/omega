/**
 * agent-plugins tests: the marketplace at the repo root, the plugin manifest
 * it points at, the shape of every skill the plugin ships, and its MCP declaration.
 * Each hook has its own agent-plugins-<hook>.test.js beside this one.
 * Run: node --test scripts/agent-plugins.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { ROOT, readJson } = require('./agent-plugins-fixtures');

const MARKETPLACE = path.join(ROOT, '.claude-plugin', 'marketplace.json');

// The skill's own frontmatter block, read without a YAML parser: the contract
// is two flat scalar keys, so a line scan is the whole job.
const frontmatter = (source) => {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const pair = line.match(/^([a-z-]+):\s*(.*)$/);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return fields;
};

test('marketplace: parses, names its owner, and lists at least one plugin', () => {
  const marketplace = readJson(MARKETPLACE);
  assert.equal(marketplace.name, 'omega');
  assert.ok(marketplace.owner && marketplace.owner.name, 'owner.name is required');
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0);
});

test('marketplace: every source resolves to a directory holding a manifest', () => {
  for (const entry of readJson(MARKETPLACE).plugins) {
    assert.ok(entry.name, 'a plugin entry needs a name');
    assert.ok(entry.source.startsWith('./'), `${entry.name}: source must be repo-relative`);

    const dir = path.join(ROOT, entry.source);
    assert.ok(fs.existsSync(dir), `${entry.name}: ${entry.source} does not exist`);

    const manifest = path.join(dir, '.claude-plugin', 'plugin.json');
    assert.ok(fs.existsSync(manifest), `${entry.name}: no .claude-plugin/plugin.json in ${entry.source}`);

    const plugin = readJson(manifest);
    assert.equal(plugin.name, entry.name, `${entry.name}: manifest name disagrees with the marketplace`);
    assert.ok(plugin.description, `${entry.name}: manifest needs a description`);
    assert.match(plugin.version, /^\d+\.\d+\.\d+$/, `${entry.name}: version must be semver`);
  }
});

test('settings: the repo registers its own marketplace and enables the plugin every session', () => {
  const settings = readJson(path.join(ROOT, '.claude', 'settings.json'));
  const marketplace = readJson(MARKETPLACE);

  assert.deepEqual(
    settings.extraKnownMarketplaces[marketplace.name].source,
    { source: 'directory', path: './' },
    'the repo IS the marketplace directory — no cache copy, no absolute path'
  );

  // A brand's committed settings say the same two things about its INSTALLED
  // manager package ([#62]) — same plugin id, so the two can never drift.
  const { PLUGIN_ID, MARKETPLACE_NAME } = require(path.join(ROOT, 'packages', 'manager', 'src', 'lib', 'claude-settings.js'));
  assert.equal(MARKETPLACE_NAME, marketplace.name);
  assert.equal(PLUGIN_ID, `${marketplace.plugins[0].name}@${marketplace.name}`);
  assert.equal(settings.enabledPlugins[PLUGIN_ID], true);
});

test('skills: each one is bare-named, matches its directory, and describes itself', () => {
  for (const entry of readJson(MARKETPLACE).plugins) {
    const skillsDir = path.join(ROOT, entry.source, 'skills');
    if (!fs.existsSync(skillsDir)) continue;

    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => item.name);

    for (const name of dirs) {
      const file = path.join(skillsDir, name, 'SKILL.md');
      assert.ok(fs.existsSync(file), `${name}: no SKILL.md`);

      const fields = frontmatter(fs.readFileSync(file, 'utf8'));
      assert.ok(fields, `${name}: SKILL.md has no frontmatter block`);
      assert.equal(fields.name, name, `${name}: frontmatter name disagrees with the directory`);
      assert.ok(!fields.name.includes(':'), `${name}: skill names are bare — the plugin supplies the omega: namespace`);
      assert.ok(fields.description, `${name}: frontmatter needs a description`);
    }
  }
});

test('mcp: the plugin declares exactly one MCP server — the router', () => {
  const mcp = readJson(path.join(ROOT, 'agent-plugins', 'claude', '.mcp.json'));
  assert.deepEqual(Object.keys(mcp.mcpServers), ['mcp-router']);
  assert.deepEqual(mcp.mcpServers['mcp-router'], {
    type: 'stdio',
    command: 'node',
    args: ['${CLAUDE_PLUGIN_ROOT}/mcp-router-launch.js'],
  });
});

test('mcp: the router entry resolves to a real file from the plugin root', () => {
  const mcp = readJson(path.join(ROOT, 'agent-plugins', 'claude', '.mcp.json'));
  const pluginRoot = path.join(ROOT, 'agent-plugins', 'claude');
  const resolved = mcp.mcpServers['mcp-router'].args[0]
    .replace('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
  assert.ok(fs.existsSync(path.resolve(resolved)), `no file at ${resolved}`);
});

/**
 * agent-plugins tests: the two marketplace manifests at the repo root (the
 * published `omega` and the local `omega-local`, one plugin folder), the plugin
 * manifest they point at, the shape of every skill the plugin ships, and its MCP declaration.
 * Each hook has its own agent-plugins-<hook>.test.js beside this one.
 * Run: node --test scripts/agent-plugins.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('fs');
const path = require('path');

const { ROOT, readJson } = require('./agent-plugins-fixtures');

const MARKETPLACE = path.join(ROOT, '.claude-plugin', 'marketplace.json');
const LOCAL_MARKETPLACE = path.join(ROOT, '.claude-plugin', 'marketplace.local.json');

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

module.exports = defineCases({
  type: 'group',
  description: 'agent-plugins',
  tests: [
    {
      name: 'marketplace: parses, names its owner, and lists at least one plugin',
      run: (ctx) => {
        const marketplace = readJson(MARKETPLACE);
        ctx.expect(marketplace.name).toBe('omega');
        ctx.expect(marketplace.owner && marketplace.owner.name, 'owner.name is required').toBeTruthy();
        ctx.expect(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0).toBeTruthy();
      },
    },

    {
      name: 'marketplace: the local manifest names omega-local and lists the same plugin folder',
      run: (ctx) => {
        const local = readJson(LOCAL_MARKETPLACE);
        ctx.expect(local.name).toBe('omega-local');
        ctx.expect(local.owner && local.owner.name, 'owner.name is required').toBeTruthy();
        ctx.expect(local.plugins.map((entry) => [entry.name, entry.source])).toEqual([['omega', './agent-plugins/claude']]);
        ctx.expect(readJson(MARKETPLACE).plugins.map((entry) => [entry.name, entry.source])).toEqual([['omega', './agent-plugins/claude']]);
      },
    },

    {
      name: 'marketplace: every source resolves to a directory holding a manifest',
      run: (ctx) => {
        for (const entry of [...readJson(MARKETPLACE).plugins, ...readJson(LOCAL_MARKETPLACE).plugins]) {
          ctx.expect(entry.name, 'a plugin entry needs a name').toBeTruthy();
          ctx.expect(entry.source.startsWith('./'), `${entry.name}: source must be repo-relative`).toBeTruthy();

          const dir = path.join(ROOT, entry.source);
          ctx.expect(fs.existsSync(dir), `${entry.name}: ${entry.source} does not exist`).toBeTruthy();

          const manifest = path.join(dir, '.claude-plugin', 'plugin.json');
          ctx.expect(fs.existsSync(manifest), `${entry.name}: no .claude-plugin/plugin.json in ${entry.source}`).toBeTruthy();

          const plugin = readJson(manifest);
          ctx.expect(plugin.name, `${entry.name}: manifest name disagrees with the marketplace`).toBe(entry.name);
          ctx.expect(plugin.description, `${entry.name}: manifest needs a description`).toBeTruthy();
          ctx.expect(plugin.version, `${entry.name}: version must be semver`).toMatch(/^\d+\.\d+\.\d+$/);
        }
      },
    },

    {
      name: 'settings: the monorepo turns on the local copy by its own name and turns the published one off',
      run: (ctx) => {
        const settings = readJson(path.join(ROOT, '.claude', 'settings.json'));

        ctx.expect(settings.extraKnownMarketplaces['omega-local'].source, 'the repo IS the local copy: its own manifest, by a relative path').toEqual({ source: 'file', path: './.claude-plugin/marketplace.local.json' });
        ctx.expect(settings.enabledPlugins['omega@omega-local']).toBe(true);
        ctx.expect(settings.enabledPlugins['omega@omega'], 'both on at once loads either copy').toBe(false);
        ctx.expect(settings.extraKnownMarketplaces.omega, 'the monorepo never declares the published name, or it would fight every live brand for its record').toBe(undefined);
      },
    },

    {
      name: 'settings: the brand writer speaks the same names the manifests declare',
      run: (ctx) => {
        const names = require(path.join(ROOT, 'packages', 'manager', 'src', 'lib', 'claude-settings.js'));
        const published = readJson(MARKETPLACE);
        const local = readJson(LOCAL_MARKETPLACE);

        ctx.expect(names.MARKETPLACE_NAME).toBe(published.name);
        ctx.expect(names.LOCAL_MARKETPLACE_NAME).toBe(local.name);
        ctx.expect(names.PLUGIN_ID).toBe(`${published.plugins[0].name}@${published.name}`);
        ctx.expect(names.LOCAL_PLUGIN_ID).toBe(`${local.plugins[0].name}@${local.name}`);
        ctx.expect(fs.existsSync(path.join(ROOT, names.LOCAL_MANIFEST)), `${names.LOCAL_MANIFEST} is a file in this repo`).toBeTruthy();
      },
    },

    {
      name: 'skills: each one is bare-named, matches its directory, and describes itself',
      run: (ctx) => {
        for (const entry of readJson(MARKETPLACE).plugins) {
          const skillsDir = path.join(ROOT, entry.source, 'skills');
          if (!fs.existsSync(skillsDir)) continue;

          const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
            .filter((item) => item.isDirectory())
            .map((item) => item.name);

          for (const name of dirs) {
            const file = path.join(skillsDir, name, 'SKILL.md');
            ctx.expect(fs.existsSync(file), `${name}: no SKILL.md`).toBeTruthy();

            const fields = frontmatter(fs.readFileSync(file, 'utf8'));
            ctx.expect(fields, `${name}: SKILL.md has no frontmatter block`).toBeTruthy();
            ctx.expect(fields.name, `${name}: frontmatter name disagrees with the directory`).toBe(name);
            ctx.expect(!fields.name.includes(':'), `${name}: skill names are bare — the plugin supplies the omega: namespace`).toBeTruthy();
            ctx.expect(fields.description, `${name}: frontmatter needs a description`).toBeTruthy();
          }
        }
      },
    },

    {
      name: 'mcp: the plugin declares exactly one MCP server — the router',
      run: (ctx) => {
        const mcp = readJson(path.join(ROOT, 'agent-plugins', 'claude', '.mcp.json'));
        ctx.expect(Object.keys(mcp.mcpServers)).toEqual(['mcp-router']);
        ctx.expect(mcp.mcpServers['mcp-router']).toEqual({
          type: 'stdio',
          command: 'node',
          args: ['${CLAUDE_PLUGIN_ROOT}/mcp-router-launch.js'],
        });
      },
    },

    {
      name: 'mcp: the router entry resolves to a real file from the plugin root',
      run: (ctx) => {
        const mcp = readJson(path.join(ROOT, 'agent-plugins', 'claude', '.mcp.json'));
        const pluginRoot = path.join(ROOT, 'agent-plugins', 'claude');
        const resolved = mcp.mcpServers['mcp-router'].args[0]
          .replace('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
        ctx.expect(fs.existsSync(path.resolve(resolved)), `no file at ${resolved}`).toBeTruthy();
      },
    },
  ],
});

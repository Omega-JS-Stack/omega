// Unit tests for tools/vendor-docs.js, the prepare-time docs lane: the
// monorepo's whole docs/ tree lands in @omega.js/manager (and nowhere else)
// with its outbound links retargeted. The Claude plugin never ships in the
// manager: it reaches a machine from GitHub. syncDocs writes only what changed.
//
// Fixtures build a miniature monorepo under packages/devkit/.temp/ (gitignored)
// and vendor from it via the monorepoRoot seam, never the real docs tree.

const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'vendor-docs',
  tests: [
    {
      name: 'vendor-docs: only the manager carries docs; any other package is a no-op',
      run: (ctx) => {
        const { root, web } = makeFixture('vendor-docs-other');
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        ctx.expect(vendorDocs({ cwd: web, monorepoRoot: root })).toEqual({ docs: [], removed: [] });
        ctx.expect(fs.existsSync(path.join(web, 'docs'))).toBe(false);
      },
    },

    {
      name: 'vendor-docs: the whole docs tree lands in the manager with the same shape',
      run: (ctx) => {
        const { root, manager } = makeFixture('vendor-docs-tree');
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        const result = vendorDocs({ cwd: manager, monorepoRoot: root });

        ctx.expect([...result.docs].sort()).toEqual([
          'omega.md', 'shared/config.md', 'web/classy-v2/DIRECTION.md', 'web/classy-v2/shot.png', 'web/index.md',
        ]);
        ctx.expect(read(manager, 'docs', 'shared', 'config.md')).toBe('# config\n');
        ctx.expect(fs.readFileSync(path.join(manager, 'docs', 'web', 'classy-v2', 'shot.png')).equals(PNG), 'binary files copy byte for byte').toBeTruthy();
      },
    },

    {
      name: 'vendor-docs: links inside docs keep their shape, links out of it are retargeted',
      run: (ctx) => {
        const { root, manager } = makeFixture('vendor-docs-links');
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        vendorDocs({ cwd: manager, monorepoRoot: root });

        const map = read(manager, 'docs', 'omega.md');
        ctx.expect(map, 'a link inside docs is untouched').toMatch(/\]\(shared\/config\.md\)/);
        ctx.expect(map, 'its anchor too').toMatch(/\]\(web\/index\.md#top\)/);
        ctx.expect(map, 'a package source link reaches the sibling in the scope').toMatch(/\]\(\.\.\/\.\.\/account\/src\)/);
        ctx.expect(map, 'the plugin does not ship, so a link into it keeps its words only').toMatch(/^Plugin: main skill$/m);
        ctx.expect(map, 'a link with no shipped target keeps its words only').toMatch(/^Brand: sandbox$/m);
        ctx.expect(map, 'a web link is untouched').toMatch(/\]\(https:\/\/github\.com\/Omega-JS-Stack\/omega\)/);
        ctx.expect(map, 'a same-page anchor is untouched').toMatch(/\]\(#below\)/);

        const guide = read(manager, 'docs', 'web', 'index.md');
        ctx.expect(guide, 'depth is counted from the nested file').toMatch(/\]\(\.\.\/\.\.\/\.\.\/web\/README\.md#usage\)/);
        ctx.expect(guide).toMatch(/\]\(\.\.\/omega\.md\)/);
        ctx.expect(read(root, 'docs', 'omega.md').includes('](../packages/account/src)'), 'the monorepo source is never touched').toBeTruthy();
      },
    },

    {
      name: 'syncDocs: a re-run writes only what changed and removes what the source dropped',
      run: (ctx) => {
        const { root, manager } = makeFixture('vendor-docs-sync');
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        syncDocs({ monorepoRoot: root, packageDir: manager });
        const untouched = path.join(manager, 'docs', 'shared', 'config.md');
        const past = new Date('2020-01-01T00:00:00Z');
        fs.utimesSync(untouched, past, past);
        fs.writeFileSync(path.join(manager, 'docs', 'AGENTS.md'), '# a stale shipped file\n');

        ctx.expect(syncDocs({ monorepoRoot: root, packageDir: manager })).toEqual({ written: [], removed: ['AGENTS.md'] });
        ctx.expect(fs.existsSync(path.join(manager, 'docs', 'AGENTS.md')), 'a file the source lacks is removed').toBe(false);

        fs.writeFileSync(path.join(root, 'docs', 'omega.md'), '# OMEGA v2\n');
        fs.rmSync(path.join(root, 'docs', 'web', 'classy-v2'), { recursive: true });

        const result = syncDocs({ monorepoRoot: root, packageDir: manager });
        ctx.expect(result.written, 'only the edited file is written').toEqual(['omega.md']);
        ctx.expect([...result.removed].sort()).toEqual(['web/classy-v2/DIRECTION.md', 'web/classy-v2/shot.png']);
        ctx.expect(read(manager, 'docs', 'omega.md')).toBe('# OMEGA v2\n');
        ctx.expect(fs.existsSync(path.join(manager, 'docs', 'web', 'classy-v2')), 'the emptied folder is pruned').toBe(false);
        ctx.expect(fs.statSync(untouched).mtime.getTime(), 'an unchanged file is never rewritten').toBe(past.getTime());
      },
    },

    {
      name: 'syncDocs: a dry run reports the same changes and writes nothing',
      run: (ctx) => {
        const { root, manager } = makeFixture('vendor-docs-dry');
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        const result = syncDocs({ monorepoRoot: root, packageDir: manager, dryRun: true });
        ctx.expect(result.written.length).toBe(5);
        ctx.expect(fs.existsSync(path.join(manager, 'docs'))).toBe(false);
      },
    },

    {
      name: 'syncDocs: a missing docs source fails loudly',
      run: (ctx) => {
        const { root, manager } = makeFixture('vendor-docs-missing');
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        fs.rmSync(path.join(root, 'docs'), { recursive: true });
        ctx.expect(() => vendorDocs({ cwd: manager, monorepoRoot: root })).toThrow(/Missing docs source/);
      },
    },

    {
      name: 'vendor-docs: the manager carries no plugin and no marketplace, though the monorepo has both',
      run: (ctx) => {
        const { root, manager } = makeFixture('vendor-docs-plugin');
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        vendorDocs({ cwd: manager, monorepoRoot: root });

        ctx.expect(fs.existsSync(path.join(manager, 'claude-plugin'))).toBe(false);
        ctx.expect(fs.existsSync(path.join(manager, '.claude-plugin'))).toBe(false);
        for (const gone of ['PLUGIN_SOURCE', 'PLUGIN_DIR', 'MARKETPLACE_FILE']) {
          ctx.expect(vendorDocs[gone], `${gone} named the vendored plugin, which is gone`).toBe(undefined);
        }
      },
    },
  ],
});

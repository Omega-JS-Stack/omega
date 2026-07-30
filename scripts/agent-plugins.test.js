/**
 * agent-plugins tests — the marketplace at the repo root, the plugin manifest
 * it points at, the shape of every skill the plugin ships, and the hook that
 * injects the matching skill into a session.
 * Run: node --test scripts/agent-plugins.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MARKETPLACE = path.join(ROOT, '.claude-plugin', 'marketplace.json');
const INJECT_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'inject', 'run.sh');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

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
    args: ['${CLAUDE_PLUGIN_ROOT}/../../packages/mcp-router/bin/mcp-router.js'],
  });
});

test('mcp: the router entry resolves to a real file from the plugin root', () => {
  const mcp = readJson(path.join(ROOT, 'agent-plugins', 'claude', '.mcp.json'));
  const pluginRoot = path.join(ROOT, 'agent-plugins', 'claude');
  const resolved = mcp.mcpServers['mcp-router'].args[0]
    .replace('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
  assert.ok(fs.existsSync(path.resolve(resolved)), `no file at ${resolved}`);
});

// --- the inject hook ---

// A project fixture: a directory with its own .git, so the hook's walk up to
// the git root stops here instead of wandering out of the temp dir.
const project = (manifest) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-inject-'));
  fs.mkdirSync(path.join(dir, '.git'));
  if (manifest !== null) {
    const body = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
    fs.writeFileSync(path.join(dir, 'package.json'), body);
  }
  return dir;
};

// A session id is unique per run — the hook's markers outlive the test process.
let sessions = 0;
const inject = (dir, session) => execFileSync(INJECT_HOOK, {
  input: JSON.stringify({ session_id: session || `test-${process.pid}-${++sessions}`, cwd: dir, prompt: 'hello' }),
  encoding: 'utf8',
});

test('inject: every framework dependency asks for its skill', () => {
  const table = {
    '@omega.js/web': 'omega:web',
    '@omega.js/backend': 'omega:backend',
    '@omega.js/desktop': 'omega:desktop',
    '@omega.js/extension': 'omega:extension',
    '@omega.js/manager': 'omega:manager',
  };

  for (const [pkg, skill] of Object.entries(table)) {
    const dir = project({ name: 'a-brand', dependencies: { [pkg]: '^1.0.0' } });
    const out = inject(dir);
    assert.match(out, new RegExp(skill), `${pkg} did not inject ${skill}`);
    assert.equal(JSON.parse(out).hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('inject: a devDependency counts too', () => {
  const dir = project({ name: 'a-brand', devDependencies: { '@omega.js/backend': '^1.0.0' } });
  assert.match(inject(dir), /omega:backend/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: depending on @omega.js/client is silent — the runtime is embedded everywhere', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/client': '^1.0.0' } });
  assert.equal(inject(dir), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: being @omega.js/client asks for omega:client', () => {
  const dir = project({ name: '@omega.js/client', version: '1.0.0' });
  assert.match(inject(dir), /omega:client/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: being a framework package asks for its own skill', () => {
  const dir = project({ name: '@omega.js/web', version: '1.0.0' });
  assert.match(inject(dir), /omega:web/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: the monorepo root asks for omega:main', () => {
  const dir = project({ name: 'omega', version: '1.0.0' });
  assert.match(inject(dir), /omega:main/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a backend app with @omega.js/backend only in functions/ still matches', () => {
  const dir = project({ name: 'a-brand', version: '1.0.0' });
  fs.mkdirSync(path.join(dir, 'functions'));
  fs.writeFileSync(
    path.join(dir, 'functions', 'package.json'),
    JSON.stringify({ name: 'a-brand-functions', dependencies: { '@omega.js/backend': '^1.0.0' } }),
  );
  assert.match(inject(dir), /omega:backend/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: two frameworks ask for both skills in one message', () => {
  const dir = project({
    name: 'a-brand',
    dependencies: { '@omega.js/web': '^1.0.0', '@omega.js/desktop': '^1.0.0' },
  });
  const out = inject(dir);
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /invoke these skills/);
  assert.match(ctx, /omega:desktop, omega:web/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: no package.json is silent', () => {
  const dir = project(null);
  assert.equal(inject(dir), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: malformed package.json is silent', () => {
  const dir = project('{ this is not json');
  assert.equal(inject(dir), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: the same session is asked once', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/desktop': '^1.0.0' } });
  const session = `repeat-${Date.now()}-${Math.random()}`;
  assert.match(inject(dir, session), /omega:desktop/);
  assert.equal(inject(dir, session), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- shape hook (PreToolUse Write|Edit): the mirrored-suite-shape guard ----

const SHAPE_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'shape', 'run.sh');
const { spawnSync } = require('child_process');

const shape = (filePath) => spawnSync(SHAPE_HOOK, {
  input: JSON.stringify({ tool_input: { file_path: filePath } }),
  encoding: 'utf8',
});

test('shape: the three always-wrong test shapes bounce in an omega project', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  for (const bad of ['__tests__/x.test.js', 'foo.spec.js', 'test/tests/x.test.js']) {
    const result = shape(path.join(dir, bad));
    assert.equal(result.status, 2, `${bad} did not bounce`);
    assert.match(result.stderr, /omega:shape/, `${bad} bounce lacks the hook name`);
    assert.match(result.stderr, /test\/<mirror>\/<name>\.test\.js/, `${bad} bounce lacks the fix`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shape: the sanctioned shape passes untouched', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/desktop': '^1.0.0' } });
  for (const good of ['test/build/x.test.js', 'src/test/suites/main/x.test.js', 'src/lib/helper.js']) {
    assert.equal(shape(path.join(dir, good)).status, 0, `${good} was bounced`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shape: projects without @omega.js deps are never policed', () => {
  const dir = project({ name: 'somebody-else', dependencies: { react: '^19.0.0' } });
  assert.equal(shape(path.join(dir, '__tests__/x.test.js')).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shape: hooks.json wires the guard as PreToolUse on Write|Edit', () => {
  const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
  const entry = hooks.PreToolUse.find((h) => h.matcher === 'Write|Edit');
  assert.ok(entry, 'no PreToolUse Write|Edit entry');
  assert.match(entry.hooks[0].command, /hooks\/shape\/run\.sh/);
});

// ---- quality hook (PostToolUse Write|Edit + Stop): the quality skills ----

const QUALITY_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'quality', 'run.sh');

// One script serves both events, so every call names the event it is playing.
const quality = (payload) => spawnSync(QUALITY_HOOK, {
  input: JSON.stringify(payload),
  encoding: 'utf8',
});

const edited = (dir, relative, session) => quality({
  hook_event_name: 'PostToolUse',
  session_id: session,
  tool_input: { file_path: path.join(dir, relative) },
});

const stopped = (session, stopHookActive) => quality({
  hook_event_name: 'Stop',
  session_id: session,
  stop_hook_active: Boolean(stopHookActive),
});

const context = (result) => {
  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  if (!result.stdout) return '';
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};

let qualitySessions = 0;
const qualitySession = () => `quality-${process.pid}-${Date.now()}-${++qualitySessions}`;

test('quality: each web surface asks for the skills that own it', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const table = [
    ['src/pages/index.html', ['omega:seo', 'omega:accessibility']],
    ['src/pages/blog/post.md', ['omega:seo', 'omega:accessibility']],
    ['core/_layouts/blueprint/index.html', ['omega:seo', 'omega:accessibility']],
    ['core/_includes/core/head.html', ['omega:seo', 'omega:accessibility']],
    ['themes/classy/_includes/frontend/sections/nav.html', ['omega:accessibility']],
    ['src/assets/css/main.scss', ['omega:accessibility', 'omega:brandcheck']],
    ['config/omega.json5', ['omega:brandcheck']],
  ];

  for (const [file, skills] of table) {
    const ctx = context(edited(dir, file, qualitySession()));
    for (const skill of skills) {
      assert.match(ctx, new RegExp(skill), `${file} did not ask for ${skill}`);
    }
    assert.match(ctx, new RegExp(file.replace(/[/.]/g, '\\$&')), `${file} is not named in the reminder`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: a non-web file is silent', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  for (const quiet of ['src/lib/helper.js', 'README.md', 'test/build/x.test.js']) {
    assert.equal(edited(dir, quiet, qualitySession()).stdout, '', `${quiet} was not silent`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: projects without @omega.js deps are never policed', () => {
  const dir = project({ name: 'somebody-else', dependencies: { react: '^19.0.0' } });
  assert.equal(edited(dir, 'src/pages/index.html', qualitySession()).stdout, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: a skill is named once per session, and the Stop pass still counts every file', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const session = qualitySession();
  assert.match(context(edited(dir, 'src/pages/index.html', session)), /omega:seo/);
  assert.equal(edited(dir, 'src/pages/about.html', session).stdout, '', 'the second page re-asked');

  const ctx = context(stopped(session));
  assert.match(ctx, /2 web surface\(s\)/);
  assert.match(ctx, /index\.html/);
  assert.match(ctx, /about\.html/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: Stop blocks once on edited surfaces, then lets the sign-off through', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const session = qualitySession();
  edited(dir, 'src/assets/css/main.scss', session);

  const blocked = JSON.parse(stopped(session).stdout);
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /omega:quality/);
  assert.match(blocked.hookSpecificOutput.additionalContext, /omega:accessibility, omega:brandcheck/);

  assert.equal(stopped(session).stdout, '', 'the block repeated with nothing new edited');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: a path with a space survives the Stop pass whole', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const session = qualitySession();
  const file = 'src/pages/case studies.html';
  assert.match(context(edited(dir, file, session)), /omega:seo/);

  const ctx = context(stopped(session));
  assert.match(ctx, /case studies\.html/, 'the path was truncated at the space');
  // The skills line is parsed off the same record — a split path would land a
  // path fragment where a skill name belongs.
  const line = ctx.split('\n').find((l) => l.startsWith('Before signing off'));
  const listed = line.match(/checklists in: (.*?)\./)[1].split(', ');
  assert.deepEqual(listed, ['omega:accessibility', 'omega:seo']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: Stop is silent with no web edit, and while a block is already active', () => {
  const clean = qualitySession();
  assert.equal(stopped(clean).stdout, '');

  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const session = qualitySession();
  edited(dir, 'src/pages/index.html', session);
  assert.equal(stopped(session, true).stdout, '', 'blocked again inside its own block');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: hooks.json wires the same script on PostToolUse Write|Edit and Stop', () => {
  const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
  const post = hooks.PostToolUse.find((h) => h.matcher === 'Write|Edit');
  assert.ok(post, 'no PostToolUse Write|Edit entry');
  assert.match(post.hooks[0].command, /hooks\/quality\/run\.sh/);
  assert.match(hooks.Stop[0].hooks[0].command, /hooks\/quality\/run\.sh/);
});

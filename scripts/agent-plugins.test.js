/**
 * agent-plugins tests — the marketplace at the repo root, the plugin manifest
 * it points at, the shape of every skill the plugin ships, and the hook that
 * injects the matching skill into a session.
 * Run: node --test scripts/agent-plugins.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
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

test('inject: a backend target with @omega.js/backend only in functions/ still matches', () => {
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

// --- the inject hook: brand-level discovery ---

// A brand fixture: the root manifest carries @omega.js/manager, config/omega.json5
// declares the targets, and each targets/<dir> carries its own manifest — the
// shape the hook has to read past the root manifest to see.
const brand = ({ config, targets } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-brand-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'a-brand', dependencies: { '@omega.js/manager': '^1.0.0' } }),
  );
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(
    path.join(dir, 'config', 'omega.json5'),
    config === undefined ? "{\n  brand: { name: 'A Brand' },\n  targets: {\n    web: {},\n    backend: {},\n  },\n}\n" : config,
  );
  for (const [name, manifest] of Object.entries(targets || {})) {
    const target = path.join(dir, 'targets', name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest));
  }
  return dir;
};

const doneWhenBrand = () => brand({
  targets: {
    website: { name: 'a-brand-website', dependencies: { '@omega.js/web': '^1.0.0' } },
    backend: { name: 'a-brand-backend', dependencies: { '@omega.js/backend': '^1.0.0' } },
  },
});

test('inject: a brand root asks for main, manager, and one skill per target', () => {
  const dir = doneWhenBrand();
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  for (const skill of ['omega:main', 'omega:manager', 'omega:web', 'omega:backend']) {
    assert.match(ctx, new RegExp(skill), `the brand root did not ask for ${skill}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a brand injection names the framework map as required reading', () => {
  const dir = doneWhenBrand();
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  assert.match(ctx, /node_modules\/@omega\.js\/AGENTS\.md/);
  assert.match(ctx, /before/i, 'the pointer is required reading BEFORE the first edit');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a target directory the config never names still asks for its skill', () => {
  const dir = brand({
    config: "{\n  targets: {\n    web: {},\n  },\n}\n",
    targets: { app: { name: 'a-brand-app', devDependencies: { '@omega.js/desktop': '^1.0.0' } } },
  });
  assert.match(inject(dir), /omega:desktop/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a target declared in config with no directory yet still asks for its skill', () => {
  const dir = brand({ config: "{\n  targets: {\n    extension: {},\n  },\n}\n" });
  assert.match(inject(dir), /omega:extension/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a backend target with its framework only in functions/ still matches', () => {
  const dir = brand({ config: '{}', targets: { backend: { name: 'a-brand-backend' } } });
  fs.mkdirSync(path.join(dir, 'targets', 'backend', 'functions'));
  fs.writeFileSync(
    path.join(dir, 'targets', 'backend', 'functions', 'package.json'),
    JSON.stringify({ name: 'fns', dependencies: { '@omega.js/backend': '^1.0.0' } }),
  );
  assert.match(inject(dir), /omega:backend/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a custom target maps to nothing', () => {
  const dir = brand({
    config: "{\n  targets: {\n    api: { type: 'custom' },\n  },\n}\n",
    targets: { api: { name: 'a-brand-api', dependencies: { express: '^4.0.0' } } },
  });
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  assert.match(ctx, /omega:manager/);
  for (const skill of ['omega:web', 'omega:backend', 'omega:desktop', 'omega:extension']) {
    assert.doesNotMatch(ctx, new RegExp(skill), `the custom target asked for ${skill}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: an unreadable config still yields the brand set from the manifests', () => {
  const dir = brand({ config: '{ this is not json5 at all', targets: { website: { name: 'w', dependencies: { '@omega.js/web': '^1.0.0' } } } });
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  assert.match(ctx, /omega:web/);
  assert.match(ctx, /omega:main/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a target that appears mid-session re-triggers its own line only', () => {
  const dir = brand({ config: '{}', targets: { website: { name: 'w', dependencies: { '@omega.js/web': '^1.0.0' } } } });
  const session = `grow-${process.pid}-${Date.now()}`;
  assert.match(inject(dir, session), /omega:web/);

  fs.mkdirSync(path.join(dir, 'targets', 'app'));
  fs.writeFileSync(
    path.join(dir, 'targets', 'app', 'package.json'),
    JSON.stringify({ name: 'a', dependencies: { '@omega.js/desktop': '^1.0.0' } }),
  );

  const ctx = JSON.parse(inject(dir, session)).hookSpecificOutput.additionalContext;
  assert.match(ctx, /omega:desktop/, 'the new target never asked for its skill');
  assert.doesNotMatch(ctx, /omega:web/, 'the already-asked skill was asked again');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a plain project is still not a brand', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /omega:main/);
  assert.doesNotMatch(ctx, /AGENTS\.md/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- gate hook (PreToolUse Write|Edit + PostToolUse Skill): the refusal ----

const GATE_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'gate', 'run.sh');

let gateSessions = 0;
const gateSession = () => `gate-${process.pid}-${Date.now()}-${++gateSessions}`;

const gate = (filePath, session) => spawnSync(GATE_HOOK, {
  input: JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: session,
    tool_name: 'Write',
    tool_input: { file_path: filePath },
  }),
  encoding: 'utf8',
});

const skillInvoked = (toolInput, session) => spawnSync(GATE_HOOK, {
  input: JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: session,
    tool_name: 'Skill',
    tool_input: toolInput,
  }),
  encoding: 'utf8',
});

// The monorepo fixture: packages/<pkg> whose manifest IS @omega.js/<pkg>.
const monorepo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-mono-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'omega' }));
  for (const pkg of ['web', 'backend', 'client', 'devkit', 'config']) {
    fs.mkdirSync(path.join(dir, 'packages', pkg), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'packages', pkg, 'package.json'),
      JSON.stringify({ name: `@omega.js/${pkg}` }),
    );
  }
  return dir;
};

test('gate: a target edit is refused until that target\'s skill was invoked', () => {
  const dir = doneWhenBrand();
  const session = gateSession();
  const file = path.join(dir, 'targets', 'website', 'src', 'pages', 'index.html');

  const refused = gate(file, session);
  assert.equal(refused.status, 2, 'the write went through with no skill loaded');
  assert.match(refused.stderr, /omega:gate/);
  assert.match(refused.stderr, /omega:web/, 'the refusal does not name the skill to invoke');

  skillInvoked({ command: 'omega:web' }, session);
  assert.equal(gate(file, session).status, 0, 'the write is still refused after the skill was invoked');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: each target surface gates on its own skill', () => {
  const dir = doneWhenBrand();
  const session = gateSession();
  const backend = path.join(dir, 'targets', 'backend', 'src', 'routes', 'x.js');

  skillInvoked({ command: 'omega:web' }, session);
  const refused = gate(backend, session);
  assert.equal(refused.status, 2, 'omega:web let a backend edit through');
  assert.match(refused.stderr, /omega:backend/);

  skillInvoked({ command: 'omega:backend' }, session);
  assert.equal(gate(backend, session).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: the bare skill name records the same invocation', () => {
  const dir = doneWhenBrand();
  const session = gateSession();
  const file = path.join(dir, 'targets', 'website', 'src', 'index.html');
  skillInvoked({ name: 'web' }, session);
  assert.equal(gate(file, session).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: the brand config gates on omega:manager', () => {
  const dir = doneWhenBrand();
  const session = gateSession();
  const file = path.join(dir, 'config', 'omega.json5');
  const refused = gate(file, session);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /omega:manager/);

  skillInvoked({ command: 'omega:manager' }, session);
  assert.equal(gate(file, session).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: a custom target gates on nothing', () => {
  const dir = brand({
    config: "{\n  targets: {\n    api: { type: 'custom' },\n  },\n}\n",
    targets: { api: { name: 'a-brand-api', dependencies: { express: '^4.0.0' } } },
  });
  assert.equal(gate(path.join(dir, 'targets', 'api', 'src', 'server.js'), gateSession()).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: everything outside a target and the config is free', () => {
  const dir = doneWhenBrand();
  const session = gateSession();
  for (const free of ['README.md', 'docs/notes.md', 'AGENTS.md', 'assets/logo.svg']) {
    assert.equal(gate(path.join(dir, free), session).status, 0, `${free} was refused`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: a monorepo package gates on its own skill, and only where one exists', () => {
  const dir = monorepo();
  const session = gateSession();

  const refused = gate(path.join(dir, 'packages', 'web', 'src', 'index.js'), session);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /omega:web/);

  for (const free of ['devkit', 'config']) {
    assert.equal(
      gate(path.join(dir, 'packages', free, 'src', 'index.js'), session).status,
      0,
      `packages/${free} gated on a skill that does not exist`,
    );
  }
  for (const free of ['docs/shared/testing.md', 'scripts/lane.js', 'agent-plugins/claude/hooks/gate/run.sh']) {
    assert.equal(gate(path.join(dir, free), session).status, 0, `${free} was refused`);
  }

  skillInvoked({ command: 'omega:web' }, session);
  assert.equal(gate(path.join(dir, 'packages', 'web', 'src', 'index.js'), session).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: a theme surface gates on omega:theme as well as its framework skill', () => {
  const dir = monorepo();
  const session = gateSession();
  const file = path.join(dir, 'packages', 'web', 'themes', 'classy', 'css', '_theme.scss');

  const refused = gate(file, session);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /omega:web/, 'the refusal does not name the framework skill');
  assert.match(refused.stderr, /omega:theme/, 'the refusal does not name the theme skill');

  // Half the answer is still a refusal, naming only what is still missing.
  skillInvoked({ command: 'omega:web' }, session);
  const half = gate(file, session);
  assert.equal(half.status, 2, 'omega:web alone unlocked a theme surface');
  assert.doesNotMatch(half.stderr, /omega:web/, 'the refusal names a skill already invoked');
  assert.match(half.stderr, /omega:theme/);

  skillInvoked({ command: 'omega:theme' }, session);
  assert.equal(gate(file, session).status, 0, 'the write is still refused with both skills invoked');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: a website target\'s theme surfaces gate on omega:theme too', () => {
  const dir = doneWhenBrand();
  const surfaces = [
    ['themes', 'toy', 'css', 'main.scss'],
    ['src', 'themes', 'toy', 'css', 'main.scss'],
    ['src', '_sections', 'marketing', 'hero', 'section.html'],
    // _components is the same override lane as _sections (overrideLanes
    // resolves both as kind 'section'), so it answers the same way.
    ['src', '_components', 'pricing', 'plan-card', 'component.html'],
    ['src', 'assets', 'css', 'main.scss'],
  ];

  for (const surface of surfaces) {
    const session = gateSession();
    const file = path.join(dir, 'targets', 'website', ...surface);

    const refused = gate(file, session);
    assert.equal(refused.status, 2, `${surface.join('/')} was not gated`);
    assert.match(refused.stderr, /omega:web/, `${surface.join('/')} did not name omega:web`);
    assert.match(refused.stderr, /omega:theme/, `${surface.join('/')} did not name omega:theme`);

    skillInvoked({ command: 'omega:web' }, session);
    skillInvoked({ command: 'omega:theme' }, session);
    assert.equal(gate(file, session).status, 0, `${surface.join('/')} stayed refused`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: a page, and a non-web target, stay on their own skill alone', () => {
  const dir = doneWhenBrand();
  const session = gateSession();

  // src/pages/ is CONTENT, not a cascade layer.
  const page = gate(path.join(dir, 'targets', 'website', 'src', 'pages', 'index.html'), session);
  assert.equal(page.status, 2);
  assert.match(page.stderr, /omega:web/);
  assert.doesNotMatch(page.stderr, /omega:theme/, 'a page asked for the theme skill');

  // The cascade is a web mechanism — a themes/ dir elsewhere is not one.
  const backend = gate(path.join(dir, 'targets', 'backend', 'src', 'themes', 'toy', 'main.scss'), session);
  assert.equal(backend.status, 2);
  assert.match(backend.stderr, /omega:backend/);
  assert.doesNotMatch(backend.stderr, /omega:theme/, 'a backend path asked for the theme skill');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: a packages/ directory that is not the monorepo is free', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-notmono-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, 'packages', 'web'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'packages', 'web', 'package.json'), JSON.stringify({ name: 'somebody-web' }));
  assert.equal(gate(path.join(dir, 'packages', 'web', 'index.js'), gateSession()).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: a brand fixture inside an internal package is that package\'s business', () => {
  const dir = monorepo();
  const fixture = path.join(dir, 'packages', 'devkit', 'test', 'fixtures', 'a-brand');
  fs.mkdirSync(path.join(fixture, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'config', 'omega.json5'),
    "{\n  targets: {\n    website: {},\n  },\n}\n",
  );
  fs.mkdirSync(path.join(fixture, 'targets', 'website'), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'targets', 'website', 'package.json'),
    JSON.stringify({ name: 'fixture-website', dependencies: { '@omega.js/web': '^1.0.0' } }),
  );

  // packages/devkit owns the whole tree and has no skill, so the fixture brand
  // inside it never becomes a brand of its own.
  const file = path.join(fixture, 'targets', 'website', 'src', 'index.html');
  assert.equal(gate(file, gateSession()).status, 0, 'a devkit fixture brand gated on its fixture target');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: a nested packages/ inside an internal package cannot win the lookup', () => {
  const dir = monorepo();
  const nested = path.join(dir, 'packages', 'devkit', 'test', 'fixtures', 'packages', 'web');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name: '@omega.js/web' }));

  // The FIRST packages/ segment names the package — packages/devkit — so the
  // fixture's own packages/web manifest never answers.
  assert.equal(
    gate(path.join(nested, 'src', 'index.js'), gateSession()).status,
    0,
    'a nested fixture packages/web gated on omega:web',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: a target path with a space gates whole', () => {
  const dir = doneWhenBrand();
  const session = gateSession();
  const file = path.join(dir, 'targets', 'website', 'src', 'pages', 'case studies.html');

  const refused = gate(file, session);
  assert.equal(refused.status, 2, 'the path was truncated at the space');
  assert.match(refused.stderr, /omega:web/);
  assert.match(refused.stderr, /case studies\.html/, 'the refusal names a split path');

  skillInvoked({ command: 'omega:web' }, session);
  assert.equal(gate(file, session).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: no file path, and a project with nothing omega about it, are silent', () => {
  const session = gateSession();
  assert.equal(spawnSync(GATE_HOOK, {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: session, tool_input: {} }),
    encoding: 'utf8',
  }).status, 0);

  const dir = project({ name: 'somebody-else', dependencies: { react: '^19.0.0' } });
  fs.mkdirSync(path.join(dir, 'targets', 'website'), { recursive: true });
  assert.equal(gate(path.join(dir, 'targets', 'website', 'index.html'), session).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: hooks.json wires the refusal on Write|Edit and the record on Skill', () => {
  const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
  const pre = hooks.PreToolUse.filter((h) => h.matcher === 'Write|Edit')
    .flatMap((h) => h.hooks.map((entry) => entry.command));
  assert.ok(pre.some((command) => /hooks\/gate\/run\.sh/.test(command)), 'no PreToolUse Write|Edit gate');

  const post = hooks.PostToolUse.filter((h) => h.matcher === 'Skill')
    .flatMap((h) => h.hooks.map((entry) => entry.command));
  assert.ok(post.some((command) => /hooks\/gate\/run\.sh/.test(command)), 'no PostToolUse Skill recorder');
});

// The mark command: the ONE sanctioned way for an agent with no Skill tool (a
// worker writes its files through Bash) to record that it read the guide.
const GATE_MARK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'gate', 'mark.sh');

// A real Claude session exports its id, so the flag lane only answers for
// itself once both session variables are gone from the environment.
const markEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  for (const key of ['CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID']) {
    if (!extra[key]) delete env[key];
  }
  return env;
};

const mark = (args, extra) => spawnSync(GATE_MARK, args, { encoding: 'utf8', env: markEnv(extra) });

test('gate: mark.sh records the read for an agent with no Skill tool', () => {
  const dir = doneWhenBrand();
  const session = gateSession();
  const file = path.join(dir, 'targets', 'website', 'src', 'pages', 'index.html');
  assert.equal(gate(file, session).status, 2, 'the surface was not gated to begin with');

  const marked = mark(['omega:web', '--session', session]);
  assert.equal(marked.status, 0, marked.stderr);
  assert.match(marked.stdout, /omega-gate/, 'mark.sh does not print the marker it wrote');
  assert.ok(fs.existsSync(marked.stdout.trim()), 'the printed marker path does not exist');

  assert.equal(gate(file, session).status, 0, 'the write is still refused after mark.sh');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: mark.sh takes the bare skill spelling the Skill event takes', () => {
  const dir = doneWhenBrand();
  const session = gateSession();
  const file = path.join(dir, 'targets', 'website', 'src', 'pages', 'index.html');
  assert.equal(gate(file, session).status, 2, 'the surface was not gated to begin with');

  const marked = mark(['web', '--session', session]);
  assert.equal(marked.status, 0, marked.stderr);
  assert.match(marked.stdout.trim(), /__omega_web\.invoked$/, 'a bare name is not recorded as its namespaced form');

  assert.equal(gate(file, session).status, 0, 'the bare spelling unlocked nothing');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: mark.sh prefers --session over the environment', () => {
  const marked = mark(['omega:web', '--session', 'flag-session'], { CLAUDE_SESSION_ID: 'env-session' });
  assert.equal(marked.status, 0, marked.stderr);
  assert.match(marked.stdout.trim(), /flag_session__omega_web\.invoked$/, 'the environment overrode an explicit --session');
});

test('gate: mark.sh takes the session id off the environment', () => {
  const dir = doneWhenBrand();
  const session = gateSession();
  const file = path.join(dir, 'targets', 'website', 'src', 'index.html');
  assert.equal(mark(['omega:web'], { CLAUDE_SESSION_ID: session }).status, 0);
  assert.equal(gate(file, session).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: mark.sh with no session id anywhere refuses', () => {
  const marked = mark(['omega:web']);
  assert.equal(marked.status, 1, 'a marker was written with no session to key it on');
  assert.match(marked.stderr, /usage/i, 'the refusal does not say how to call it');
});

// ---- shape hook (PreToolUse Write|Edit): the mirrored-suite-shape guard ----

const SHAPE_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'shape', 'run.sh');

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

// ---- guard hook (PreToolUse Write|Edit): the upstream-first boundary ----

const GUARD_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'guard', 'run.sh');

// An Edit payload carries no content; a Write carries what is about to land —
// which is the only thing a brand-new shadow path can be judged on.
const guard = (filePath, { content, env } = {}) => spawnSync(GUARD_HOOK, {
  input: JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: content === undefined ? 'Edit' : 'Write',
    tool_input: content === undefined
      ? { file_path: filePath }
      : { file_path: filePath, content },
  }),
  encoding: 'utf8',
  env: { ...process.env, ...(env || {}) },
});

// The LIVE install the shadow lookup reads: node_modules/@omega.js/<framework>,
// exactly where a real brand keeps it.
const install = (dir, framework, files) => {
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(dir, 'node_modules', '@omega.js', framework, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
};

const write = (dir, rel, body) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
};

const guardBrand = () => {
  const dir = brand({
    targets: {
      website: { name: 'a-brand-website', dependencies: { '@omega.js/web': '^1.0.0' } },
      backend: { name: 'a-brand-backend', dependencies: { '@omega.js/backend': '^1.0.0' } },
    },
  });
  // The REAL shapes, names and all: the guard is only as honest as the tree it
  // reads, and every one of these paths exists in the shipped packages.
  install(dir, 'web', {
    'core/_layouts/blueprint/index.html': '<html></html>\n',
    'core/_includes/core/head.html': '<head></head>\n',
    'core/css/main.scss': '// core\n',
    'core/css/pages/404/index.scss': '// the 404 page sheet\n',
    'core/js/main.js': '// core main\n',
    'core/js/pages/blog.js': '// a page module, not a shadow\n',
    'themes/classy/_includes/marketing/nav.html': '<nav></nav>\n',
    'themes/classy/css/base/_type.scss': '// type\n',
    'themes/base/_sections/marketing/hero/section.html': '<section></section>\n',
    'defaults/pages/index.md': '# home\n',
    'defaults/pages/about.md': '# about\n',
    'defaults/pages/pricing.md': '# pricing\n',
    'defaults/pages/contact.md': '# contact\n',
  });
  install(dir, 'backend', {
    'templates/firestore.framework.rules': '// the framework half\n',
    'templates/firestore.rules': '// the seed a brand owns after setup\n',
    'src/manager/routes/general/email/post.js': 'module.exports = {};\n',
    'src/manager/schemas/general/email/post.js': 'module.exports = {};\n',
    'src/manager/index.js': '// the Manager class\n',
    'src/manager/libraries/email/index.js': '// framework internals\n',
  });
  return dir;
};

test('guard: generated and vendored files are refused outright', () => {
  const dir = guardBrand();
  const cases = [
    ['node_modules/@omega.js/web/core/_includes/core/head.html', /node_modules/],
    ['targets/website/dist/index.html', /dist/],
    ['targets/backend/database.rules.json', /omega\.json5|setup/],
  ];
  for (const [rel, names] of cases) {
    const result = guard(path.join(dir, rel));
    assert.equal(result.status, 2, `${rel} was let through`);
    assert.match(result.stderr, /omega:guard/, `${rel} refusal lacks the hook name`);
    assert.match(result.stderr, names, `${rel} refusal does not name the real source to edit`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: a generated header refuses the whole file', () => {
  const dir = guardBrand();
  const marked = write(dir, 'targets/website/src/generated.html',
    '<!-- GENERATED FILE — DO NOT EDIT -->\n<p>x</p>\n');
  const banner = write(dir, 'targets/website/src/banner.html',
    '<!-- Generated by @omega.js/web -->\n<p>x</p>\n');

  for (const file of [marked, banner]) {
    const result = guard(file);
    assert.equal(result.status, 2, `${file} was let through`);
    assert.match(result.stderr, /omega:guard/);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: a shadow copy is refused and names the framework file it mirrors', () => {
  const dir = guardBrand();
  // One row per real override-layer root — the MECHANISM lanes only.
  const table = [
    ['targets/website/src/_layouts/blueprint/index.html', '@omega.js/web/core/_layouts/blueprint/index.html'],
    ['targets/website/src/_includes/core/head.html', '@omega.js/web/core/_includes/core/head.html'],
    ['targets/website/src/_includes/marketing/nav.html', '@omega.js/web/themes/classy/_includes/marketing/nav.html'],
    ['targets/website/src/_sections/marketing/hero/section.html', '@omega.js/web/themes/base/_sections/marketing/hero/section.html'],
    ['targets/website/src/assets/css/pages/404/index.scss', '@omega.js/web/core/css/pages/404/index.scss'],
    ['targets/website/src/assets/css/base/_type.scss', '@omega.js/web/themes/classy/css/base/_type.scss'],
    ['targets/backend/firestore.framework.rules', '@omega.js/backend/templates/firestore.framework.rules'],
    ['targets/backend/src/routes/general/email/post.js', '@omega.js/backend/src/manager/routes/general/email/post.js'],
    ['targets/backend/src/schemas/general/email/post.js', '@omega.js/backend/src/manager/schemas/general/email/post.js'],
  ];

  for (const [rel, mirrored] of table) {
    write(dir, rel, 'a hand-written copy\n');
    const result = guard(path.join(dir, rel));
    assert.equal(result.status, 2, `${rel} was let through`);
    assert.match(result.stderr, /omega:guard/);
    assert.ok(result.stderr.includes(mirrored), `${rel} refusal does not name ${mirrored}`);
    assert.match(result.stderr, /upstream-first/, `${rel} refusal does not say to file a framework issue`);
    assert.match(result.stderr, /omega:consumer-override:/, `${rel} refusal does not name the marker`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: content is never guarded — a brand page named like a default is its own', () => {
  const dir = guardBrand();
  // src/pages/ is the DESIGNED place for a brand's own copy: every page the
  // framework ships a default for is a page a brand is expected to write.
  for (const name of ['index.md', 'about.md', 'pricing.md', 'contact.md']) {
    const rel = `targets/website/src/pages/${name}`;
    assert.equal(guard(write(dir, rel, '# our own page\n')).status, 0, `${rel} was refused`);
    assert.equal(guard(path.join(dir, rel), { content: '# a fresh page\n' }).status, 0, `a new ${rel} was refused`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: the documented consumer entry files are free, and a union lane is not a shadow', () => {
  const dir = guardBrand();
  const free = [
    // theming.md tier 1 / the web guide's REPLACE-with-extend lane
    'targets/website/src/assets/css/main.scss',
    'targets/website/src/assets/js/main.js',
    // page and layout modules are a UNION (#624) — every layer's file runs
    'targets/website/src/assets/js/pages/blog.js',
    // not a layer root at all
    'targets/website/src/js/main.js',
    // the brand's authored Cloud Functions entry
    'targets/backend/src/index.js',
  ];
  for (const rel of free) {
    assert.equal(guard(write(dir, rel, 'brand content\n')).status, 0, `${rel} was refused`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: the marker in the first five lines passes the same file', () => {
  const dir = guardBrand();
  const rel = 'targets/website/src/_includes/core/head.html';
  assert.equal(guard(write(dir, rel, 'a hand-written copy\n')).status, 2, 'the shadow was not refused to begin with');

  write(dir, rel, '<!-- omega:consumer-override: this brand ships its own head -->\n<head></head>\n');
  assert.equal(guard(path.join(dir, rel)).status, 0, 'the marker did not let the edit through');

  // Below the first five lines it is a comment, not a marker.
  write(dir, rel, '1\n2\n3\n4\n5\n// omega:consumer-override: too late\n');
  assert.equal(guard(path.join(dir, rel)).status, 2, 'a marker on line six counted');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: a NEW shadow path is judged on the content being written', () => {
  const dir = guardBrand();
  const file = path.join(dir, 'targets', 'website', 'src', '_includes', 'core', 'head.html');

  const refused = guard(file, { content: '<head></head>\n' });
  assert.equal(refused.status, 2, 'a brand-new shadow include was let through');
  assert.ok(refused.stderr.includes('@omega.js/web/core/_includes/core/head.html'));

  const allowed = guard(file, { content: '{% comment %}\n  omega:consumer-override: materialized by omega customize _includes/core/head.html\n{% endcomment %}\n' });
  assert.equal(allowed.status, 0, 'the marker in the written content did not let it through');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: OMEGA_CONSUMER_OVERRIDE=1 skips class 2 and never class 1', () => {
  const dir = guardBrand();
  const env = { OMEGA_CONSUMER_OVERRIDE: '1' };
  const shadow = write(dir, 'targets/website/src/_includes/core/head.html', 'a hand-written copy\n');
  assert.equal(guard(shadow, { env }).status, 0, 'the env flag did not skip the shadow check');

  for (const rel of ['node_modules/@omega.js/web/core/css/main.scss', 'targets/website/dist/index.html', 'targets/backend/database.rules.json']) {
    assert.equal(guard(path.join(dir, rel), { env }).status, 2, `${rel} escaped through the env flag`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: plain brand files and the brand\'s own rules source are free', () => {
  const dir = guardBrand();
  const free = [
    'targets/website/src/assets/css/brand.scss',
    'targets/backend/src/routes/checkout/post.js',
    'targets/backend/firestore.rules',
    'targets/backend/storage.rules',
    'targets/backend/firebase.json',
    'README.md',
    'config/omega.json5',
  ];
  for (const rel of free) {
    assert.equal(guard(write(dir, rel, 'brand content\n')).status, 0, `${rel} was refused`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: the monorepo itself is never guarded', () => {
  const dir = monorepo();
  install(dir, 'web', { 'core/_includes/core/head.html': '<head></head>\n' });
  fs.mkdirSync(path.join(dir, 'brands', 'playground', 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'brands', 'playground', 'config', 'omega.json5'), "{\n  targets: {\n    website: {},\n  },\n}\n");
  write(dir, 'brands/playground/targets/website/package.json', JSON.stringify({ name: 'p', dependencies: { '@omega.js/web': '^1.0.0' } }));
  install(path.join(dir, 'brands', 'playground'), 'web', { 'core/_includes/core/head.html': '<head></head>\n' });

  for (const rel of [
    'brands/playground/targets/website/src/_includes/core/head.html',
    'packages/web/dist/index.js',
    'packages/web/core/_includes/core/head.html',
  ]) {
    assert.equal(guard(write(dir, rel, 'crew content\n')).status, 0, `${rel} was guarded inside the monorepo`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: a project that is not a brand, and a missing jq, fail open', () => {
  const plain = project({ name: 'somebody-else', dependencies: { react: '^19.0.0' } });
  assert.equal(guard(write(plain, 'node_modules/react/index.js', 'x\n')).status, 0);
  fs.rmSync(plain, { recursive: true, force: true });

  const nothing = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-guard-bare-'));
  fs.mkdirSync(path.join(nothing, '.git'));
  assert.equal(guard(path.join(nothing, 'dist', 'index.js')).status, 0, 'a directory with no manifest was guarded');
  fs.rmSync(nothing, { recursive: true, force: true });

  // No jq: a PATH carrying every other tool the script uses, and not that one.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-guard-bin-'));
  for (const tool of ['env', 'bash', 'cat', 'dirname', 'basename', 'head', 'grep']) {
    const real = execFileSync('command', ['-v', tool], { shell: '/bin/bash', encoding: 'utf8' }).trim();
    fs.symlinkSync(real, path.join(bin, tool));
  }
  const dir = guardBrand();
  const jqless = guard(path.join(dir, 'targets', 'website', 'dist', 'index.html'), { env: { PATH: bin } });
  assert.equal(jqless.status, 0, `no jq did not fail open: ${jqless.stderr}`);
  fs.rmSync(bin, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: a relative file_path fails open instead of walking forever', () => {
  // No .git anywhere up the tree, which is what exposes the loop: a walk that
  // only stops at a git root never stops when `dirname` bottoms out at ".".
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-guard-rel-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'a-brand', dependencies: { '@omega.js/manager': '^1.0.0' } }));
  // `dirname` of a relative path bottoms out at "." and stays there, so an
  // unanchored walk never terminates. Both walks refuse a non-absolute dir.
  const result = spawnSync('timeout', ['10', GUARD_HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'targets/website/src/_includes/core/head.html' },
    }),
    cwd: dir,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 124, 'the hook spun forever on a relative path');
  assert.equal(result.status, 0, `a relative path did not fail open: ${result.stderr}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guard: hooks.json wires the guard as a third PreToolUse Write|Edit command', () => {
  const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
  const entry = hooks.PreToolUse.find((h) => h.matcher === 'Write|Edit');
  assert.ok(entry, 'no PreToolUse Write|Edit entry');
  const commands = entry.hooks.map((hook) => hook.command);
  assert.ok(commands.some((command) => /hooks\/guard\/run\.sh/.test(command)), 'the guard is not registered');
});

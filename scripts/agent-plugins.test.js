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
    'ultimate-jekyll-manager': 'omega:ujm',
    'backend-manager': 'omega:bem',
    'browser-extension-manager': 'omega:bxm',
    'electron-manager': 'omega:em',
    'mobile-app-manager': 'omega:mam',
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
  const dir = project({ name: 'a-brand', devDependencies: { 'backend-manager': '^1.0.0' } });
  assert.match(inject(dir), /omega:bem/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: depending on web-manager is silent — the library is embedded everywhere', () => {
  const dir = project({ name: 'a-brand', dependencies: { 'web-manager': '^1.0.0' } });
  assert.equal(inject(dir), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: being web-manager asks for omega:wm', () => {
  const dir = project({ name: 'web-manager', version: '1.0.0' });
  assert.match(inject(dir), /omega:wm/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a BEM consumer with backend-manager only in functions/ still matches', () => {
  const dir = project({ name: 'a-brand', version: '1.0.0' });
  fs.mkdirSync(path.join(dir, 'functions'));
  fs.writeFileSync(
    path.join(dir, 'functions', 'package.json'),
    JSON.stringify({ name: 'a-brand-functions', dependencies: { 'backend-manager': '^1.0.0' } }),
  );
  assert.match(inject(dir), /omega:bem/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: two frameworks ask for both skills in one message', () => {
  const dir = project({
    name: 'a-brand',
    dependencies: { 'ultimate-jekyll-manager': '^1.0.0', 'electron-manager': '^1.0.0' },
  });
  const out = inject(dir);
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /invoke these skills/);
  assert.match(ctx, /omega:em, omega:ujm/);
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
  const dir = project({ name: 'a-brand', dependencies: { 'electron-manager': '^1.0.0' } });
  const session = `repeat-${Date.now()}-${Math.random()}`;
  assert.match(inject(dir, session), /omega:em/);
  assert.equal(inject(dir, session), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

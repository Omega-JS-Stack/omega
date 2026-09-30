/**
 * The throwaway projects and hook runners the agent-plugins suites share:
 * agent-plugins.test.js (the plugin itself) and one agent-plugins-<hook>.test.js
 * per hook, the subagent suite being the inject hook's SubagentStart mode.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLUGIN_ROOT = path.join(ROOT, 'agent-plugins', 'claude');
const INJECT_HOOK = path.join(PLUGIN_ROOT, 'hooks', 'inject', 'run.sh');
const GATE_HOOK = path.join(PLUGIN_ROOT, 'hooks', 'gate', 'run.sh');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

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

// A session id is unique per run: the hook's markers outlive the test process.
let sessions = 0;
const inject = (dir, session) => execFileSync(INJECT_HOOK, {
  input: JSON.stringify({ session_id: session || `test-${process.pid}-${++sessions}`, cwd: dir, prompt: 'hello' }),
  encoding: 'utf8',
});

// A brand fixture: the root manifest carries @omega.js/manager, config/omega.json5
// declares the targets, and each targets/<dir> carries its own manifest, the
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
    config === undefined ? "{\n  brand: { name: 'A Brand' },\n  targets: {\n    web: { type: 'web' },\n    backend: { type: 'backend' },\n  },\n}\n" : config,
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
    web: { name: 'a-brand-web', dependencies: { '@omega.js/web': '^1.0.0' } },
    backend: { name: 'a-brand-backend', dependencies: { '@omega.js/backend': '^1.0.0' } },
  },
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

const gate = (filePath, session) => spawnSync(GATE_HOOK, {
  input: JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: session,
    tool_name: 'Write',
    tool_input: { file_path: filePath },
  }),
  encoding: 'utf8',
});

module.exports = {
  ROOT,
  PLUGIN_ROOT,
  INJECT_HOOK,
  GATE_HOOK,
  readJson,
  project,
  inject,
  brand,
  doneWhenBrand,
  monorepo,
  gate,
};

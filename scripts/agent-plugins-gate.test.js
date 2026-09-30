/**
 * The gate hook (PreToolUse Write|Edit + PostToolUse Skill): an edit to a
 * framework surface is refused until the skill owning it was invoked, or
 * recorded through mark.sh.
 * Run: node --test scripts/agent-plugins-gate.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ROOT, GATE_HOOK, readJson, project, brand, doneWhenBrand, monorepo, gate } = require('./agent-plugins-fixtures');

let gateSessions = 0;
const gateSession = () => `gate-${process.pid}-${Date.now()}-${++gateSessions}`;

const skillInvoked = (toolInput, session) => spawnSync(GATE_HOOK, {
  input: JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: session,
    tool_name: 'Skill',
    tool_input: toolInput,
  }),
  encoding: 'utf8',
});

test('gate: a target edit is refused until that target\'s skill was invoked', () => {
  const dir = doneWhenBrand();
  const session = gateSession();
  const file = path.join(dir, 'targets', 'web', 'src', 'pages', 'index.html');

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
  const file = path.join(dir, 'targets', 'web', 'src', 'index.html');
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

test('gate: a web target\'s theme surfaces gate on omega:theme too', () => {
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
    const file = path.join(dir, 'targets', 'web', ...surface);

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
  const page = gate(path.join(dir, 'targets', 'web', 'src', 'pages', 'index.html'), session);
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
    "{\n  targets: {\n    web: { type: 'web' },\n  },\n}\n",
  );
  fs.mkdirSync(path.join(fixture, 'targets', 'web'), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'targets', 'web', 'package.json'),
    JSON.stringify({ name: 'fixture-web', dependencies: { '@omega.js/web': '^1.0.0' } }),
  );

  // packages/devkit owns the whole tree and has no skill, so the fixture brand
  // inside it never becomes a brand of its own.
  const file = path.join(fixture, 'targets', 'web', 'src', 'index.html');
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
  const file = path.join(dir, 'targets', 'web', 'src', 'pages', 'case studies.html');

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
  fs.mkdirSync(path.join(dir, 'targets', 'web'), { recursive: true });
  assert.equal(gate(path.join(dir, 'targets', 'web', 'index.html'), session).status, 0);
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
  const file = path.join(dir, 'targets', 'web', 'src', 'pages', 'index.html');
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
  const file = path.join(dir, 'targets', 'web', 'src', 'pages', 'index.html');
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
  const file = path.join(dir, 'targets', 'web', 'src', 'index.html');
  assert.equal(mark(['omega:web'], { CLAUDE_SESSION_ID: session }).status, 0);
  assert.equal(gate(file, session).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate: mark.sh with no session id anywhere refuses', () => {
  const marked = mark(['omega:web']);
  assert.equal(marked.status, 1, 'a marker was written with no session to key it on');
  assert.match(marked.stderr, /usage/i, 'the refusal does not say how to call it');
});

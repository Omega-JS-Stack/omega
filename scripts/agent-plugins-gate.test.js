/**
 * The gate hook (PreToolUse Write|Edit + PostToolUse Skill): an edit to a
 * framework surface is refused until the skill owning it was invoked, or
 * recorded through mark.sh.
 * Run: node --test scripts/agent-plugins-gate.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'agent-plugins-gate',
  tests: [
    {
      name: 'gate: a target edit is refused until that target\'s skill was invoked',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = gateSession();
        const file = path.join(dir, 'targets', 'web', 'src', 'pages', 'index.html');

        const refused = gate(file, session);
        ctx.expect(refused.status, 'the write went through with no skill loaded').toBe(2);
        ctx.expect(refused.stderr).toMatch(/omega:gate/);
        ctx.expect(refused.stderr, 'the refusal does not name the skill to invoke').toMatch(/omega:web/);

        skillInvoked({ command: 'omega:web' }, session);
        ctx.expect(gate(file, session).status, 'the write is still refused after the skill was invoked').toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: each target surface gates on its own skill',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = gateSession();
        const backend = path.join(dir, 'targets', 'backend', 'src', 'routes', 'x.js');

        skillInvoked({ command: 'omega:web' }, session);
        const refused = gate(backend, session);
        ctx.expect(refused.status, 'omega:web let a backend edit through').toBe(2);
        ctx.expect(refused.stderr).toMatch(/omega:backend/);

        skillInvoked({ command: 'omega:backend' }, session);
        ctx.expect(gate(backend, session).status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: the bare skill name records the same invocation',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = gateSession();
        const file = path.join(dir, 'targets', 'web', 'src', 'index.html');
        skillInvoked({ name: 'web' }, session);
        ctx.expect(gate(file, session).status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: the brand config gates on omega:manager',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = gateSession();
        const file = path.join(dir, 'config', 'omega.json5');
        const refused = gate(file, session);
        ctx.expect(refused.status).toBe(2);
        ctx.expect(refused.stderr).toMatch(/omega:manager/);

        skillInvoked({ command: 'omega:manager' }, session);
        ctx.expect(gate(file, session).status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: a custom target gates on nothing',
      run: (ctx) => {
        const dir = brand({
          config: "{\n  targets: {\n    api: { type: 'custom' },\n  },\n}\n",
          targets: { api: { name: 'a-brand-api', dependencies: { express: '^4.0.0' } } },
        });
        ctx.expect(gate(path.join(dir, 'targets', 'api', 'src', 'server.js'), gateSession()).status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: everything outside a target and the config is free',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = gateSession();
        for (const free of ['README.md', 'docs/notes.md', 'AGENTS.md', 'assets/logo.svg']) {
          ctx.expect(gate(path.join(dir, free), session).status, `${free} was refused`).toBe(0);
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: a monorepo package gates on its own skill, and only where one exists',
      run: (ctx) => {
        const dir = monorepo();
        const session = gateSession();

        const refused = gate(path.join(dir, 'packages', 'web', 'src', 'index.js'), session);
        ctx.expect(refused.status).toBe(2);
        ctx.expect(refused.stderr).toMatch(/omega:web/);

        for (const free of ['devkit', 'config']) {
          ctx.expect(gate(path.join(dir, 'packages', free, 'src', 'index.js'), session).status, `packages/${free} gated on a skill that does not exist`).toBe(0);
        }
        for (const free of ['docs/shared/testing.md', 'scripts/lane.js', 'agent-plugins/claude/hooks/gate/run.sh']) {
          ctx.expect(gate(path.join(dir, free), session).status, `${free} was refused`).toBe(0);
        }

        skillInvoked({ command: 'omega:web' }, session);
        ctx.expect(gate(path.join(dir, 'packages', 'web', 'src', 'index.js'), session).status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: a theme surface gates on omega:theme as well as its framework skill',
      run: (ctx) => {
        const dir = monorepo();
        const session = gateSession();
        const file = path.join(dir, 'packages', 'web', 'themes', 'classy', 'css', '_theme.scss');

        const refused = gate(file, session);
        ctx.expect(refused.status).toBe(2);
        ctx.expect(refused.stderr, 'the refusal does not name the framework skill').toMatch(/omega:web/);
        ctx.expect(refused.stderr, 'the refusal does not name the theme skill').toMatch(/omega:theme/);

        // Half the answer is still a refusal, naming only what is still missing.
        skillInvoked({ command: 'omega:web' }, session);
        const half = gate(file, session);
        ctx.expect(half.status, 'omega:web alone unlocked a theme surface').toBe(2);
        ctx.expect(half.stderr, 'the refusal names a skill already invoked').not.toMatch(/omega:web/);
        ctx.expect(half.stderr).toMatch(/omega:theme/);

        skillInvoked({ command: 'omega:theme' }, session);
        ctx.expect(gate(file, session).status, 'the write is still refused with both skills invoked').toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: a web target\'s theme surfaces gate on omega:theme too',
      run: (ctx) => {
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
          ctx.expect(refused.status, `${surface.join('/')} was not gated`).toBe(2);
          ctx.expect(refused.stderr, `${surface.join('/')} did not name omega:web`).toMatch(/omega:web/);
          ctx.expect(refused.stderr, `${surface.join('/')} did not name omega:theme`).toMatch(/omega:theme/);

          skillInvoked({ command: 'omega:web' }, session);
          skillInvoked({ command: 'omega:theme' }, session);
          ctx.expect(gate(file, session).status, `${surface.join('/')} stayed refused`).toBe(0);
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: a page, and a non-web target, stay on their own skill alone',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = gateSession();

        // src/pages/ is CONTENT, not a cascade layer.
        const page = gate(path.join(dir, 'targets', 'web', 'src', 'pages', 'index.html'), session);
        ctx.expect(page.status).toBe(2);
        ctx.expect(page.stderr).toMatch(/omega:web/);
        ctx.expect(page.stderr, 'a page asked for the theme skill').not.toMatch(/omega:theme/);

        // The cascade is a web mechanism — a themes/ dir elsewhere is not one.
        const backend = gate(path.join(dir, 'targets', 'backend', 'src', 'themes', 'toy', 'main.scss'), session);
        ctx.expect(backend.status).toBe(2);
        ctx.expect(backend.stderr).toMatch(/omega:backend/);
        ctx.expect(backend.stderr, 'a backend path asked for the theme skill').not.toMatch(/omega:theme/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: a packages/ directory that is not the monorepo is free',
      run: (ctx) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-notmono-'));
        fs.mkdirSync(path.join(dir, '.git'));
        fs.mkdirSync(path.join(dir, 'packages', 'web'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'packages', 'web', 'package.json'), JSON.stringify({ name: 'somebody-web' }));
        ctx.expect(gate(path.join(dir, 'packages', 'web', 'index.js'), gateSession()).status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: a brand fixture inside an internal package is that package\'s business',
      run: (ctx) => {
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
        ctx.expect(gate(file, gateSession()).status, 'a devkit fixture brand gated on its fixture target').toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: a nested packages/ inside an internal package cannot win the lookup',
      run: (ctx) => {
        const dir = monorepo();
        const nested = path.join(dir, 'packages', 'devkit', 'test', 'fixtures', 'packages', 'web');
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name: '@omega.js/web' }));

        // The FIRST packages/ segment names the package — packages/devkit — so the
        // fixture's own packages/web manifest never answers.
        ctx.expect(gate(path.join(nested, 'src', 'index.js'), gateSession()).status, 'a nested fixture packages/web gated on omega:web').toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: a target path with a space gates whole',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = gateSession();
        const file = path.join(dir, 'targets', 'web', 'src', 'pages', 'case studies.html');

        const refused = gate(file, session);
        ctx.expect(refused.status, 'the path was truncated at the space').toBe(2);
        ctx.expect(refused.stderr).toMatch(/omega:web/);
        ctx.expect(refused.stderr, 'the refusal names a split path').toMatch(/case studies\.html/);

        skillInvoked({ command: 'omega:web' }, session);
        ctx.expect(gate(file, session).status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: no file path, and a project with nothing omega about it, are silent',
      run: (ctx) => {
        const session = gateSession();
        ctx.expect(spawnSync(GATE_HOOK, {
          input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: session, tool_input: {} }),
          encoding: 'utf8',
        }).status).toBe(0);

        const dir = project({ name: 'somebody-else', dependencies: { react: '^19.0.0' } });
        fs.mkdirSync(path.join(dir, 'targets', 'web'), { recursive: true });
        ctx.expect(gate(path.join(dir, 'targets', 'web', 'index.html'), session).status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: hooks.json wires the refusal on Write|Edit and the record on Skill',
      run: (ctx) => {
        const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
        const pre = hooks.PreToolUse.filter((h) => h.matcher === 'Write|Edit')
          .flatMap((h) => h.hooks.map((entry) => entry.command));
        ctx.expect(pre.some((command) => /hooks\/gate\/run\.sh/.test(command)), 'no PreToolUse Write|Edit gate').toBeTruthy();

        const post = hooks.PostToolUse.filter((h) => h.matcher === 'Skill')
          .flatMap((h) => h.hooks.map((entry) => entry.command));
        ctx.expect(post.some((command) => /hooks\/gate\/run\.sh/.test(command)), 'no PostToolUse Skill recorder').toBeTruthy();
      },
    },

    {
      name: 'gate: mark.sh records the read for an agent with no Skill tool',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = gateSession();
        const file = path.join(dir, 'targets', 'web', 'src', 'pages', 'index.html');
        ctx.expect(gate(file, session).status, 'the surface was not gated to begin with').toBe(2);

        const marked = mark(['omega:web', '--session', session]);
        ctx.expect(marked.status, marked.stderr).toBe(0);
        ctx.expect(marked.stdout, 'mark.sh does not print the marker it wrote').toMatch(/omega-gate/);
        ctx.expect(fs.existsSync(marked.stdout.trim()), 'the printed marker path does not exist').toBeTruthy();

        ctx.expect(gate(file, session).status, 'the write is still refused after mark.sh').toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: mark.sh takes the bare skill spelling the Skill event takes',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = gateSession();
        const file = path.join(dir, 'targets', 'web', 'src', 'pages', 'index.html');
        ctx.expect(gate(file, session).status, 'the surface was not gated to begin with').toBe(2);

        const marked = mark(['web', '--session', session]);
        ctx.expect(marked.status, marked.stderr).toBe(0);
        ctx.expect(marked.stdout.trim(), 'a bare name is not recorded as its namespaced form').toMatch(/__omega_web\.invoked$/);

        ctx.expect(gate(file, session).status, 'the bare spelling unlocked nothing').toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: mark.sh prefers --session over the environment',
      run: (ctx) => {
        const marked = mark(['omega:web', '--session', 'flag-session'], { CLAUDE_SESSION_ID: 'env-session' });
        ctx.expect(marked.status, marked.stderr).toBe(0);
        ctx.expect(marked.stdout.trim(), 'the environment overrode an explicit --session').toMatch(/flag_session__omega_web\.invoked$/);
      },
    },

    {
      name: 'gate: mark.sh takes the session id off the environment',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = gateSession();
        const file = path.join(dir, 'targets', 'web', 'src', 'index.html');
        ctx.expect(mark(['omega:web'], { CLAUDE_SESSION_ID: session }).status).toBe(0);
        ctx.expect(gate(file, session).status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'gate: mark.sh with no session id anywhere refuses',
      run: (ctx) => {
        const marked = mark(['omega:web']);
        ctx.expect(marked.status, 'a marker was written with no session to key it on').toBe(1);
        ctx.expect(marked.stderr, 'the refusal does not say how to call it').toMatch(/usage/i);
      },
    },
  ],
});

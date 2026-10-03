/**
 * The npx hook (PreToolUse Bash): an omega CLI run through the registry
 * fetcher is refused where no installed omega bin resolves.
 * Run: node --test scripts/agent-plugins-npx.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ROOT, readJson } = require('./agent-plugins-fixtures');

const NPX_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'npx', 'run.sh');

// A Bash event carries the command and the session's working directory; the
// hook resolves the bin from that directory up.
const npx = (command, cwd, { env, raw } = {}) => spawnSync(NPX_HOOK, {
  input: raw !== undefined ? raw : JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd,
    tool_input: { command },
  }),
  encoding: 'utf8',
  cwd,
  env: { ...process.env, ...(env || {}) },
});

// A checkout with, or without, the one bin that proves a framework is installed.
const npxDir = ({ bin = false, nested } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-npx-'));
  fs.mkdirSync(path.join(dir, '.git'));
  if (bin) {
    fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');
  }
  if (nested) fs.mkdirSync(path.join(dir, nested), { recursive: true });
  return dir;
};

// Every form that means "run the omega CLI through the registry fetcher".
const NPX_FORMS = [
  'npx omega deploy',
  'npx omg test',
  'npx --no-install mgr version',
  'npx -y omega build',
  'npm exec omega build',
  'npm exec -- omega',
  'npm run build && npx omega test',
  // A VERSION spec is the most direct registry fetch of the lot, so the bin
  // name carries an optional `@<spec>` suffix.
  'npx omega@latest build',
  'npx omg@next build',
  'npm exec -- mgr@1.2.3 build',
];

module.exports = defineCases({
  type: 'group',
  description: 'agent-plugins-npx',
  tests: [
    {
      name: 'npx: every npx/npm exec form is refused where no omega bin resolves',
      run: (ctx) => {
        const dir = npxDir();
        for (const command of NPX_FORMS) {
          const result = npx(command, dir);
          ctx.expect(result.status, `${command} was let through`).toBe(2);
          ctx.expect(result.stderr, `${command} refusal lacks the hook name`).toMatch(/omega:npx/);
          ctx.expect(result.stderr, `${command} refusal lacks the bin it looked for`).toMatch(/node_modules\/\.bin\/omega/);
          ctx.expect(result.stderr.includes(dir), `${command} refusal does not name the directory it searched`).toBeTruthy();
          // The sibling hooks' message shape: the finding, where it looked, the fix,
          // then the doc that owns the rule.
          ctx.expect(result.stderr, `${command} refusal lacks the fix`).toMatch(/run the install first, or run the package's own bin by path/);
          ctx.expect(result.stderr, `${command} refusal lacks the doc pointer`).toMatch(/docs\/shared\/local-dev\.md/);
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'npx: the same forms pass once the bin is installed',
      run: (ctx) => {
        const dir = npxDir({ bin: true });
        for (const command of NPX_FORMS) {
          ctx.expect(npx(command, dir).status, `${command} was refused with the bin present`).toBe(0);
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'npx: the walk reaches the bin at the root of a nested target',
      run: (ctx) => {
        const dir = npxDir({ bin: true, nested: path.join('targets', 'web', 'src') });
        ctx.expect(npx('npx omega build', path.join(dir, 'targets', 'web', 'src')).status).toBe(0);

        const bare = npxDir({ nested: path.join('targets', 'web', 'src') });
        ctx.expect(npx('npx omega build', path.join(bare, 'targets', 'web', 'src')).status, 'a nested dir with no bin anywhere up was allowed').toBe(2);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(bare, { recursive: true, force: true });
      },
    },

    {
      name: 'npx: the walk stops at the git root',
      run: (ctx) => {
        // The bin sits ABOVE the checkout, which is not this project's install.
        const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-npx-outer-'));
        fs.mkdirSync(path.join(outer, 'node_modules', '.bin'), { recursive: true });
        fs.writeFileSync(path.join(outer, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');
        const inner = path.join(outer, 'checkout');
        fs.mkdirSync(path.join(inner, '.git'), { recursive: true });
        ctx.expect(npx('npx omega build', inner).status, 'the walk climbed past the git root').toBe(2);
        fs.rmSync(outer, { recursive: true, force: true });
      },
    },

    {
      name: 'npx: an absolute cd prefix resolves from the directory it lands in',
      run: (ctx) => {
        const installed = npxDir({ bin: true });
        const bare = npxDir();

        ctx.expect(npx(`cd ${installed} && npx omega build`, bare).status, 'the cd target with the bin was refused').toBe(0);
        ctx.expect(npx(`cd ${bare} && npx omega build`, installed).status, 'the cd target without the bin was allowed').toBe(2);
        // A relative hop cannot be resolved from here, so it fails open; the hop lands on a root, where every verb runs.
        ctx.expect(npx('cd ../acme && npx omega build --target=web', bare).status, 'a relative cd did not fail open').toBe(0);
        fs.rmSync(installed, { recursive: true, force: true });
        fs.rmSync(bare, { recursive: true, force: true });
      },
    },

    {
      name: 'npx: commands that do not name the omega bins are never touched',
      run: (ctx) => {
        const dir = npxDir();
        const free = [
          'npx eleventy --serve',
          'npx omega-foo build',
          'npm exec eleventy',
          'npm run omega',
          'echo "npx omega build"',
          './node_modules/.bin/omega test',
          '',
        ];
        for (const command of free) {
          ctx.expect(npx(command, dir).status, `${command || '<empty>'} was refused`).toBe(0);
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'npx: a missing command, garbage stdin, and no jq all fail open',
      run: (ctx) => {
        const dir = npxDir();
        ctx.expect(npx(undefined, dir, { raw: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }) }).status, 'a payload with no command was refused').toBe(0);
        ctx.expect(npx(undefined, dir, { raw: 'not json at all' }).status, 'garbage stdin was refused').toBe(0);
        ctx.expect(npx(undefined, dir, { raw: '' }).status, 'empty stdin was refused').toBe(0);

        // No jq: a PATH carrying every other tool the script uses, and not that one.
        const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-npx-bin-'));
        for (const tool of ['env', 'bash', 'cat', 'dirname']) {
          const real = execFileSync('command', ['-v', tool], { shell: '/bin/bash', encoding: 'utf8' }).trim();
          fs.symlinkSync(real, path.join(bin, tool));
        }
        const jqless = npx('npx omega deploy', dir, { env: { PATH: bin } });
        ctx.expect(jqless.status, `no jq did not fail open: ${jqless.stderr}`).toBe(0);
        fs.rmSync(bin, { recursive: true, force: true });
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'npx: with no cwd in the payload the hook reads its own',
      run: (ctx) => {
        const dir = npxDir();
        const result = npx(undefined, dir, {
          raw: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npx omega deploy' } }),
        });
        ctx.expect(result.status, 'the hook did not fall back to its own working directory').toBe(2);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'npx: hooks.json wires the refusal as PreToolUse on Bash',
      run: (ctx) => {
        const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
        const entry = hooks.PreToolUse.find((h) => h.matcher === 'Bash');
        ctx.expect(entry, 'no PreToolUse Bash entry').toBeTruthy();
        const commands = entry.hooks.map((hook) => hook.command);
        ctx.expect(commands.some((command) => /hooks\/npx\/run\.sh/.test(command)), 'the npx hook is not registered').toBeTruthy();

        // The Write|Edit entry keeps its three hooks, untouched by the new one.
        const writes = hooks.PreToolUse.find((h) => h.matcher === 'Write|Edit');
        ctx.expect(writes, 'the Write|Edit entry is gone').toBeTruthy();
        ctx.expect(writes.hooks.length, 'the Write|Edit entry changed shape').toBe(3);
      },
    },
  ],
});

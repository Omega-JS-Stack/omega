/**
 * The npx hook (PreToolUse Bash): an omega CLI run through the registry
 * fetcher is refused where no installed omega bin resolves.
 * Run: node --test scripts/agent-plugins-npx.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('npx: every npx/npm exec form is refused where no omega bin resolves', () => {
  const dir = npxDir();
  for (const command of NPX_FORMS) {
    const result = npx(command, dir);
    assert.equal(result.status, 2, `${command} was let through`);
    assert.match(result.stderr, /omega:npx/, `${command} refusal lacks the hook name`);
    assert.match(result.stderr, /node_modules\/\.bin\/omega/, `${command} refusal lacks the bin it looked for`);
    assert.ok(result.stderr.includes(dir), `${command} refusal does not name the directory it searched`);
    // The sibling hooks' message shape: the finding, where it looked, the fix,
    // then the doc that owns the rule.
    assert.match(result.stderr, /run the install first, or run the package's own bin by path/, `${command} refusal lacks the fix`);
    assert.match(result.stderr, /docs\/shared\/local-dev\.md/, `${command} refusal lacks the doc pointer`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('npx: the same forms pass once the bin is installed', () => {
  const dir = npxDir({ bin: true });
  for (const command of NPX_FORMS) {
    assert.equal(npx(command, dir).status, 0, `${command} was refused with the bin present`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('npx: the walk reaches the bin at the root of a nested target', () => {
  const dir = npxDir({ bin: true, nested: path.join('targets', 'web', 'src') });
  assert.equal(npx('npx omega build', path.join(dir, 'targets', 'web', 'src')).status, 0);

  const bare = npxDir({ nested: path.join('targets', 'web', 'src') });
  assert.equal(npx('npx omega build', path.join(bare, 'targets', 'web', 'src')).status, 2, 'a nested dir with no bin anywhere up was allowed');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
});

test('npx: the walk stops at the git root', () => {
  // The bin sits ABOVE the checkout, which is not this project's install.
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-npx-outer-'));
  fs.mkdirSync(path.join(outer, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(outer, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');
  const inner = path.join(outer, 'checkout');
  fs.mkdirSync(path.join(inner, '.git'), { recursive: true });
  assert.equal(npx('npx omega build', inner).status, 2, 'the walk climbed past the git root');
  fs.rmSync(outer, { recursive: true, force: true });
});

test('npx: an absolute cd prefix resolves from the directory it lands in', () => {
  const installed = npxDir({ bin: true });
  const bare = npxDir();

  assert.equal(npx(`cd ${installed} && npx omega build`, bare).status, 0, 'the cd target with the bin was refused');
  assert.equal(npx(`cd ${bare} && npx omega build`, installed).status, 2, 'the cd target without the bin was allowed');
  // A relative hop cannot be resolved from here, so it fails open; the hop lands on a root, where every verb runs.
  assert.equal(npx('cd ../acme && npx omega build --target=web', bare).status, 0, 'a relative cd did not fail open');
  fs.rmSync(installed, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
});

test('npx: commands that do not name the omega bins are never touched', () => {
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
    assert.equal(npx(command, dir).status, 0, `${command || '<empty>'} was refused`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('npx: a missing command, garbage stdin, and no jq all fail open', () => {
  const dir = npxDir();
  assert.equal(npx(undefined, dir, { raw: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }) }).status, 0, 'a payload with no command was refused');
  assert.equal(npx(undefined, dir, { raw: 'not json at all' }).status, 0, 'garbage stdin was refused');
  assert.equal(npx(undefined, dir, { raw: '' }).status, 0, 'empty stdin was refused');

  // No jq: a PATH carrying every other tool the script uses, and not that one.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-npx-bin-'));
  for (const tool of ['env', 'bash', 'cat', 'dirname']) {
    const real = execFileSync('command', ['-v', tool], { shell: '/bin/bash', encoding: 'utf8' }).trim();
    fs.symlinkSync(real, path.join(bin, tool));
  }
  const jqless = npx('npx omega deploy', dir, { env: { PATH: bin } });
  assert.equal(jqless.status, 0, `no jq did not fail open: ${jqless.stderr}`);
  fs.rmSync(bin, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('npx: with no cwd in the payload the hook reads its own', () => {
  const dir = npxDir();
  const result = npx(undefined, dir, {
    raw: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npx omega deploy' } }),
  });
  assert.equal(result.status, 2, 'the hook did not fall back to its own working directory');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('npx: hooks.json wires the refusal as PreToolUse on Bash', () => {
  const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
  const entry = hooks.PreToolUse.find((h) => h.matcher === 'Bash');
  assert.ok(entry, 'no PreToolUse Bash entry');
  const commands = entry.hooks.map((hook) => hook.command);
  assert.ok(commands.some((command) => /hooks\/npx\/run\.sh/.test(command)), 'the npx hook is not registered');

  // The Write|Edit entry keeps its three hooks, untouched by the new one.
  const writes = hooks.PreToolUse.find((h) => h.matcher === 'Write|Edit');
  assert.ok(writes, 'the Write|Edit entry is gone');
  assert.equal(writes.hooks.length, 3, 'the Write|Edit entry changed shape');
});

/**
 * A backend target in CUSTOM-SERVER mode, from the manager's side
 * ([#584](https://github.com/Omega-JS-Stack/omega/issues/584)).
 *
 * `targets.backend.projectType: 'custom'` is the same @omega.js/backend
 * running as an Express app on `PORT` for a container host (Render & co)
 * instead of exporting Cloud Functions. The framework's Firebase-only verbs
 * refuse in that mode, so the manager must not dispatch them: a custom-mode
 * backend deploys and tests through its OWN package.json scripts — the same
 * lane a custom TARGET uses (#603) — and its dev leg is `npm run start`, not
 * the emulator.
 *
 * Not to be confused with #603's `type: 'custom'`: that is a target no
 * framework owns. This one IS a framework target, with a different artifact.
 *
 * What these tests hold it to:
 *   - discovery reads the mode off the brand config and marks the entry;
 *   - `resolveTargetRun` sends deploy and test through the target's scripts,
 *     skips loudly when the script is absent, and stops at the plan on a dry run;
 *   - a firebase-mode backend is completely unchanged (it still dispatches
 *     through its framework bin);
 *   - the dev fan-out boots the server, not the emulator;
 *   - the testing service stops failing a custom backend for the
 *     `firebase.json` it correctly does not have, and says why.
 *
 * Real brand monorepos on disk; no script is ever spawned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { discoverTargets } = require('../src/lib/brand.js');
const { resolveTargetRun } = require('../src/lib/framework-bin.js');
const { devLegFor } = require('../src/commands/dev.js');
const { checkTargetFiles } = require('../src/services/testing/lib/checks.js');

const BASE = { brand: { id: 'b', name: 'B', url: 'https://b.test' } };

/**
 * A brand monorepo with a website and a backend target, the backend declaring
 * `projectType` (omitted = the firebase default) and carrying `scripts`.
 */
function makeBrand({ projectType, scripts = {}, files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omega-backend-mode-'));
  const backend = projectType ? { projectType } : {};

  jetpack.write(join(root, 'config', 'omega.json5'), JSON.stringify({ ...BASE, targets: { web: {}, backend } }, null, 2));
  jetpack.write(join(root, 'package.json'), { name: 'b', workspaces: ['targets/*'] });
  jetpack.write(join(root, 'targets', 'website', 'package.json'), { name: 'website', dependencies: { '@omega.js/web': '*' } });
  jetpack.write(join(root, 'targets', 'backend', 'package.json'), {
    name: 'backend',
    dependencies: { '@omega.js/backend': '*' },
    scripts,
  });

  for (const [relative, contents] of Object.entries(files)) {
    jetpack.write(join(root, relative), contents);
  }

  return root;
}

const backendEntry = (root) => discoverTargets(root).find((entry) => entry.target === 'backend');

// ─── Discovery ───────────────────────────────────────────────────────────────

test('discovery reads the project type off the brand config and marks the backend entry', () => {
  const custom = backendEntry(makeBrand({ projectType: 'custom' }));
  assert.equal(custom.target, 'backend', 'a custom-MODE backend is still a framework target');
  assert.equal(custom.custom, undefined, "and never a custom TARGET (#603's flag)");
  assert.equal(custom.projectType, 'custom');

  assert.equal(backendEntry(makeBrand({ projectType: 'firebase' })).projectType, 'firebase');
  assert.equal(backendEntry(makeBrand()).projectType, 'firebase', 'unset is the Cloud Functions default');

  // The mode is a backend fact — nothing else carries it
  const web = discoverTargets(makeBrand({ projectType: 'custom' })).find((entry) => entry.target === 'web');
  assert.equal(web.projectType, undefined);
});

// ─── The verb lanes ──────────────────────────────────────────────────────────

test('a custom-mode backend deploys and tests through its OWN scripts, no flags forwarded', () => {
  const entry = backendEntry(makeBrand({ projectType: 'custom', scripts: { deploy: 'render deploys create', test: 'node --test' } }));

  for (const verb of ['deploy', 'test']) {
    const run = resolveTargetRun(entry, verb, ['--dry-run']);
    assert.equal(run.kind, 'custom', `${verb} must not dispatch through the framework bin`);
    assert.equal(run.command, 'npm');
    assert.deepEqual(run.args, ['run', verb], 'a package script has no contract for framework flags');
  }
});

test('a custom-mode backend with no such script steps aside loudly, naming the target and the verb', () => {
  const entry = backendEntry(makeBrand({ projectType: 'custom', scripts: { test: 'node --test' } }));

  const run = resolveTargetRun(entry, 'deploy', []);
  assert.equal(run.kind, 'skip');
  assert.match(run.detail, /deploy/);
  assert.match(run.detail, /targets\/backend/);
});

test('a custom-mode backend stops at the PLAN on a dry run — its script cannot honor the flag', () => {
  const entry = backendEntry(makeBrand({ projectType: 'custom', scripts: { deploy: 'render deploys create' } }));

  const run = resolveTargetRun(entry, 'deploy', [], { dryRun: true });
  assert.equal(run.kind, 'plan');
  assert.match(run.detail, /npm run deploy/);
});

test('a firebase-mode backend is untouched — every verb still dispatches through the framework', () => {
  const root = makeBrand({ scripts: { deploy: 'never run this' } });
  const entry = backendEntry(root);
  // A real bin so the framework lane can resolve (the climb reads package.json)
  jetpack.write(join(root, 'node_modules', '@omega.js/backend', 'package.json'), { name: '@omega.js/backend', bin: { omega: 'bin/omega' } });
  jetpack.write(join(root, 'node_modules', '@omega.js/backend', 'bin', 'omega'), '#!/usr/bin/env node\n');

  const run = resolveTargetRun(entry, 'deploy', ['--dry-run']);
  assert.equal(run.kind, 'framework', 'the default mode must keep dispatching `omega deploy`');
  assert.equal(run.framework, '@omega.js/backend');
  assert.deepEqual(run.args.slice(1), ['deploy', '--dry-run'], 'and it still forwards the brand flags');
});

// ─── The dev leg ─────────────────────────────────────────────────────────────

test('the dev leg for a custom-mode backend is its own server, not the emulator', () => {
  assert.deepEqual(devLegFor({ target: 'backend', projectType: 'custom' }), ['npm', 'run', 'start']);
  assert.deepEqual(devLegFor({ target: 'backend', projectType: 'firebase' }), ['npm', 'run', 'emulator']);
  assert.deepEqual(devLegFor({ target: 'backend' }), ['npm', 'run', 'emulator']);
  assert.deepEqual(devLegFor({ target: 'web' }), ['npm', 'run', 'start']);
  assert.deepEqual(devLegFor({ target: 'api', custom: true }), ['npm', 'run', 'start'], "#603's custom targets keep their leg");
});

// ─── The Firebase-only check ─────────────────────────────────────────────────

test('the testing service stops demanding a firebase.json a custom backend has no reason to carry', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));

  const recorder = { passed: [], failed: [], notes: [] };
  const record = {
    pass: (name) => recorder.passed.push(name),
    fail: (name, error) => recorder.failed.push({ name, error }),
    warn: () => {},
    note: (name, detail) => recorder.notes.push(`${name}: ${detail}`),
  };

  try {
    const root = makeBrand({ projectType: 'custom', files: { 'targets/backend/dist/package.json': { name: 'staged' } } });
    checkTargetFiles(record, backendEntry(root));
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(recorder.failed, [], 'a custom backend has no firebase.json and that is correct');
  assert.ok(recorder.passed.includes('backend: staged dist/'), 'the build output is still checked — a custom backend still stages');
  assert.ok(
    recorder.notes.some((note) => note.includes('firebase.json') && note.includes('custom')),
    `the skipped check must say WHY it did not run: ${JSON.stringify(recorder.notes)}`,
  );
});

test('a firebase-mode backend still fails without its firebase.json', () => {
  const recorder = { passed: [], failed: [], notes: [] };
  const record = {
    pass: (name) => recorder.passed.push(name),
    fail: (name, error) => recorder.failed.push({ name, error }),
    warn: () => {},
    note: (name, detail) => recorder.notes.push(`${name}: ${detail}`),
  };
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));

  try {
    checkTargetFiles(record, backendEntry(makeBrand()));
  } finally {
    console.log = originalLog;
  }

  assert.ok(recorder.failed.some((entry) => entry.name === 'backend: firebase.json'));
});

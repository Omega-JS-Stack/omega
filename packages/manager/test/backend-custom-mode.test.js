/**
 * A backend target in CUSTOM-SERVER mode, from the manager's side
 * ([#584](https://github.com/Omega-JS-Stack/omega/issues/584)).
 *
 * `targets.backend.projectType: 'custom'` is the same @omega.js/backend
 * running as an Express app on `PORT` for a container host (Render & co)
 * instead of exporting Cloud Functions. The framework's Firebase-only verbs
 * refuse in that mode, so the brand owns the scripts that would run them: its
 * `deploy` is the host's publish command, which the fan-out's one lane
 * (`npm run <verb>`, every target alike) runs, and its dev leg is
 * `npm run start`, not the emulator.
 *
 * Not to be confused with #603's `type: 'custom'`: that is a target no
 * framework owns. This one IS a framework target, with a different artifact.
 *
 * What these tests hold it to:
 *   - discovery reads the mode off the brand config and marks the entry;
 *   - `resolveTargetRun` runs deploy and test through the target's scripts,
 *     skips loudly when the script is absent, and stops at the plan on a dry
 *     run, since the brand's own script cannot honor the flag;
 *   - a firebase-mode backend runs the same lane, its `omega deploy` script
 *     taking the flag;
 *   - the dev fan-out boots the server, not the emulator;
 *   - the testing service stops failing a custom backend for the
 *     `firebase.json` it correctly does not have, and says why.
 *
 * Real brand monorepos on disk; no script is ever spawned.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { discoverTargets } = require('../src/lib/brand.js');
const { resolveTargetRun } = require('../src/lib/framework-bin.js');
const devCommand = require('../src/commands/dev.js');
const { checkTargetFiles } = require('../src/services/testing/lib/checks.js');

const BASE = { brand: { id: 'b', name: 'B', url: 'https://b.test' } };

/**
 * A brand monorepo with a web and a backend target, the backend declaring
 * `projectType` (omitted = the firebase default) and carrying `scripts`.
 */
function makeBrand({ projectType, scripts = {}, files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omega-backend-mode-'));
  const backend = { type: 'backend', ...(projectType ? { projectType } : {}) };

  jetpack.write(join(root, 'config', 'omega.json5'), JSON.stringify({ ...BASE, targets: { web: { type: 'web' }, backend } }, null, 2));
  jetpack.write(join(root, 'package.json'), { name: 'b', workspaces: ['targets/*'] });
  jetpack.write(join(root, 'targets', 'web', 'package.json'), { name: 'web', dependencies: { '@omega.js/web': '*' } });
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

module.exports = defineCases({
  type: 'group',
  description: 'backend-custom-mode',
  tests: [
    // ─── Discovery ───────────────────────────────────────────────────────────────

    {
      name: 'discovery reads the project type off the brand config and marks the backend entry',
      run: (ctx) => {
        const custom = backendEntry(makeBrand({ projectType: 'custom' }));
        ctx.expect(custom.target, 'a custom-MODE backend is still a framework target').toBe('backend');
        ctx.expect(custom.custom, "and never a custom TARGET (#603's flag)").toBe(undefined);
        ctx.expect(custom.projectType).toBe('custom');

        ctx.expect(backendEntry(makeBrand({ projectType: 'firebase' })).projectType).toBe('firebase');
        ctx.expect(backendEntry(makeBrand()).projectType, 'unset is the Cloud Functions default').toBe('firebase');

        // The mode is a backend fact — nothing else carries it
        const web = discoverTargets(makeBrand({ projectType: 'custom' })).find((entry) => entry.target === 'web');
        ctx.expect(web.projectType).toBe(undefined);
      },
    },

    // ─── The verb lanes ──────────────────────────────────────────────────────────

    {
      name: 'a custom-mode backend deploys and tests through its OWN scripts, bare',
      run: (ctx) => {
        const entry = backendEntry(makeBrand({ projectType: 'custom', scripts: { deploy: 'render deploys create', test: 'node --test' } }));

        for (const verb of ['deploy', 'test']) {
          const run = resolveTargetRun(entry, verb, ['--snapshot=abc']);
          ctx.expect(run.kind, 'a custom-MODE backend is still a framework target').toBe('framework');
          ctx.expect(run.command).toBe('npm');
          ctx.expect(run.args, 'the brand\'s own script hears no framework flags').toEqual(['run', verb]);
        }
      },
    },

    {
      name: 'a custom-mode backend with no such script steps aside loudly, naming the target and the verb',
      run: (ctx) => {
        const entry = backendEntry(makeBrand({ projectType: 'custom', scripts: { test: 'node --test' } }));

        const run = resolveTargetRun(entry, 'deploy', []);
        ctx.expect(run.kind).toBe('skip');
        ctx.expect(run.detail).toMatch(/deploy/);
        ctx.expect(run.detail).toMatch(/targets\/backend/);
      },
    },

    {
      name: 'a custom-mode backend stops at the PLAN on a dry run — its script cannot honor the flag',
      run: (ctx) => {
        const entry = backendEntry(makeBrand({ projectType: 'custom', scripts: { deploy: 'render deploys create' } }));

        const run = resolveTargetRun(entry, 'deploy', [], { dryRun: true });
        ctx.expect(run.kind).toBe('plan');
        ctx.expect(run.detail).toMatch(/npm run deploy/);
      },
    },

    {
      name: 'a firebase-mode backend runs the same lane, and its own `omega deploy` takes the dry-run flag',
      run: (ctx) => {
        const entry = backendEntry(makeBrand({ scripts: { deploy: 'omega deploy' } }));

        const run = resolveTargetRun(entry, 'deploy', ['--dry-run'], { dryRun: true });
        ctx.expect(run.kind).toBe('framework');
        ctx.expect(run.framework).toBe('@omega.js/backend');
        ctx.expect(run.args, 'the framework verb plans itself').toEqual(['run', 'deploy', '--', '--dry-run']);
      },
    },

    // ─── The dev leg ─────────────────────────────────────────────────────────────

    {
      name: 'the dev leg for a custom-mode backend is its own start script, the one leg every target runs',
      run: (ctx) => {
        ctx.expect(devCommand.DEV_LEG).toEqual(['npm', 'run', 'start']);
        ctx.expect(devCommand.devLegFor, 'no per-kind leg table: the mode decides what `start` runs, never the manager').toBe(undefined);
        ctx.expect(devCommand.DEV_LEGS).toBe(undefined);
      },
    },

    // ─── The Firebase-only check ─────────────────────────────────────────────────

    {
      name: 'the testing service stops demanding a firebase.json a custom backend has no reason to carry',
      run: (ctx) => {
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

        ctx.expect(recorder.failed, 'a custom backend has no firebase.json and that is correct').toEqual([]);
        ctx.expect(recorder.passed.includes('backend: staged dist/'), 'the build output is still checked — a custom backend still stages').toBeTruthy();
        ctx.expect(recorder.notes.some((note) => note.includes('firebase.json') && note.includes('custom')), `the skipped check must say WHY it did not run: ${JSON.stringify(recorder.notes)}`).toBeTruthy();
      },
    },

    {
      name: 'a firebase-mode backend still fails without its firebase.json',
      run: (ctx) => {
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

        ctx.expect(recorder.failed.some((entry) => entry.name === 'backend: firebase.json')).toBeTruthy();
      },
    },
  ],
});

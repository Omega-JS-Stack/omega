/**
 * Custom targets (#603) — a brand target the framework does not own (a Render
 * API, a worker, a script), declared `targets.<name>: { type: 'custom' }` and
 * driven ENTIRELY by its own package.json scripts.
 *
 * What the contract promises, and what these tests hold it to:
 *   - config accepts any key whose entry declares `type: 'custom'`, and an
 *     entry with no type at all is an error (#886);
 *   - the manager runs a verb through the target's script and skips loudly when
 *     the script is absent (the one lane, `resolveTargetRun`);
 *   - every framework service op skips custom targets — except the workspace
 *     service (which recognizes the dir instead of warning it unmapped);
 *   - brand-root `omega dev` boots the custom target's `start` in the same
 *     terminal fan-out.
 *
 * The brand-root `omega build` / `omega clean` fan-outs — verb order over every
 * target type, and the loud skip in a real run — are build-clean-command.test.js.
 * Nothing here spawns a real script.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { validateConfig } = require('@omega.js/config/validate');
const { customTargetNames, targetScripts } = require('../src/lib/custom-target.js');
const { discoverTargets } = require('../src/lib/brand.js');
const { resolveTargetRun, resolveTargetScaffold } = require('../src/lib/framework-bin.js');
const ensureStructure = require('../src/services/workspace/ensure/structure.js');
const { selectDevTargets } = require('../src/commands/dev.js');
const { selectTargets } = require('../src/commands/deploy.js');

const BASE = { brand: { id: 'b', name: 'B', url: 'https://b.test' } };

/**
 * A brand monorepo on disk with a website target and a custom `api` target
 * whose package.json carries `scripts`.
 */
function makeBrand({ scripts = {}, targets = { web: { type: 'web' }, api: { type: 'custom' } }, dirs = ['web', 'api'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omega-custom-'));
  jetpack.write(join(root, 'config', 'omega.json5'), JSON.stringify({ ...BASE, targets }, null, 2));
  jetpack.write(join(root, 'package.json'), { name: 'b', workspaces: ['targets/*'] });

  for (const dir of dirs) {
    jetpack.write(join(root, 'targets', dir, 'package.json'), {
      name: dir,
      ...(dir === 'web' ? { dependencies: { '@omega.js/web': '*' } } : { scripts }),
    });
  }

  return root;
}

module.exports = defineCases({
  type: 'group',
  description: 'custom-target',
  tests: [
    // ─── config: the target type ─────────────────────────────────────────────────

    {
      name: 'config: targets.<name> with type custom is a valid target key',
      run: (ctx) => {
        const { errors } = validateConfig({ ...BASE, targets: { web: { type: 'web' }, api: { type: 'custom' } } });
        ctx.expect(errors).toEqual([]);
      },
    },

    {
      name: 'config: a second custom target is a sibling KEY, never an array (#886)',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...BASE,
          targets: { api: { type: 'custom' }, worker: { type: 'custom' } },
        });
        ctx.expect(errors).toEqual([]);
      },
    },

    {
      name: 'config: a target key WITHOUT a type is an error naming the key',
      run: (ctx) => {
        const { errors } = validateConfig({ ...BASE, targets: { api: {} } });
        ctx.expect(errors.length).toBe(1);
        ctx.expect(errors[0]).toMatch(/config\.targets\.api/);
        ctx.expect(errors[0]).toMatch(/type/);
      },
    },

    // ─── discovery ───────────────────────────────────────────────────────────────

    {
      name: 'custom-target: the declared names come off the config, and the name IS the dir',
      run: (ctx) => {
        const config = { ...BASE, targets: { web: { type: 'web' }, api: { type: 'custom' }, nightly: { type: 'custom' } } };

        ctx.expect(customTargetNames(config)).toEqual(['api', 'nightly']);
      },
    },

    {
      name: 'custom-target: discoverTargets marks the dir custom instead of leaving it unmapped',
      run: (ctx) => {
        const root = makeBrand();
        try {
          const found = discoverTargets(root);
          const api = found.find((entry) => entry.name === 'api');

          ctx.expect(api.custom).toBe(true);
          // `target` stays null so every existing framework-service filter
          // (`entry.target`) skips it by construction
          ctx.expect(api.target).toBe(null);
          ctx.expect(found.find((entry) => entry.name === 'web').custom).toBe(undefined);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    },

    // ─── the verbs ───────────────────────────────────────────────────────────────

    {
      name: 'custom-target: a target with no package.json scripts declares no verbs',
      run: (ctx) => {
        const root = makeBrand({ scripts: {} });
        try {
          const entry = discoverTargets(root).find((item) => item.name === 'api');
          ctx.expect(targetScripts(entry.path)).toEqual({});
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    },

    // ─── service ops: skipped, except workspace ──────────────────────────────────

    {
      name: 'custom-target: the workspace structure check recognizes the dir, never warns it unmapped',
      run: async (ctx) => {
        const root = makeBrand();
        const lines = [];
        const original = console.log;
        console.log = (...args) => lines.push(args.join(' '));

        try {
          const targets = discoverTargets(root);
          const result = await ensureStructure({
            brandRoot: root,
            brand: {
              root,
              config: { ...BASE, targets: { web: { type: 'web' }, api: { type: 'custom' } } },
              enabledTargets: ['web', 'api'],
            },
            targets,
            options: {},
          });

          ctx.expect(result.status).not.toBe('error');
          ctx.expect(lines.join('\n')).not.toMatch(/maps to no target/);
          // The declared custom target with no dir IS still a problem, same as a
          // framework target's — proven below
        } finally {
          console.log = original;
          rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'custom-target: a declared custom target with no dir is reported like any other',
      run: async (ctx) => {
        const root = makeBrand({ dirs: ['web'] });
        try {
          const result = await ensureStructure({
            brandRoot: root,
            brand: {
              root,
              config: { ...BASE, targets: { web: { type: 'web' }, api: { type: 'custom' } } },
              enabledTargets: ['web', 'api'],
            },
            targets: discoverTargets(root),
            options: {},
          });

          ctx.expect(result.status).toBe('error');
          ctx.expect(result.error).toMatch(/targets\/api/);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    },

    // ─── the dev fan-out ─────────────────────────────────────────────────────────

    {
      name: 'custom-target: omega dev boots the custom target beside the framework legs',
      run: (ctx) => {
        const { selected } = selectDevTargets({ available: [{ name: 'web', target: 'web' }, { name: 'backend', target: 'backend' }, { name: 'api', target: null }], custom: ['api'] });
        ctx.expect(selected.sort()).toEqual(['api', 'backend', 'web']);
      },
    },

    {
      name: 'custom-target: --target= still narrows to one custom leg',
      run: (ctx) => {
        const { selected } = selectDevTargets({ available: [{ name: 'web', target: 'web' }, { name: 'api', target: null }], custom: ['api'], target: 'api' });
        ctx.expect(selected).toEqual(['api']);
      },
    },

    {
      name: 'custom-target: a custom target with no start script is not a dev leg — naming it stops the boot',
      run: (ctx) => {
        ctx.expect(() => selectDevTargets({ available: [{ name: 'web', target: 'web' }], custom: [], target: 'api' })).toThrow((error) => {
            ctx.expect(error.refusal).toBe(true);
            ctx.expect(error.message).toMatch(/Unknown --target token "api"/);
            return true;
          });
      },
    },

    // ─── the deploy / test fan-outs ──────────────────────────────────────────────

    {
      name: 'custom-target: the brand deploy fan-out includes custom targets, LAST',
      run: (ctx) => {
        const { selected } = selectTargets({
          targets: [
            { name: 'api', target: null, custom: true },
            { name: 'web', target: 'web' },
            { name: 'backend', target: 'backend' },
          ],
        });

        // Framework order is unchanged and custom targets deploy after them — the
        // brand's own services depend on the API being live, never the reverse
        ctx.expect(selected.map((entry) => entry.name)).toEqual(['backend', 'web', 'api']);
      },
    },

    {
      name: 'custom-target: the fan-outs run a custom target\'s own script, bare',
      run: (ctx) => {
        const root = makeBrand({ scripts: { deploy: 'render deploy', test: 'node --test' } });
        try {
          const entry = discoverTargets(root).find((item) => item.name === 'api');

          const deploy = resolveTargetRun(entry, 'deploy', ['--snapshot=abc']);
          ctx.expect(deploy.kind).toBe('custom');
          ctx.expect(deploy.command).toBe('npm');
          ctx.expect(deploy.args, 'a package script has no contract for the brand flags').toEqual(['run', 'deploy']);
          ctx.expect(deploy.label).toBe('npm run deploy');

          // An absent verb is the loud skip, never an error
          const clean = resolveTargetRun(entry, 'clean', []);
          ctx.expect(clean.kind).toBe('skip');
          ctx.expect(clean.detail).toMatch(/no "clean" script/);

          // A DRY RUN must never execute a custom script: it has no contract for the flag
          const dry = resolveTargetRun(entry, 'deploy', ['--dry-run'], { dryRun: true });
          ctx.expect(dry.kind).toBe('plan');
          ctx.expect(dry.detail).toMatch(/npm run deploy/);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    },

    // ─── the in-process scaffold the deploy fan-out calls (#901) ─────────────────

    {
      name: 'resolveTargetScaffold: a framework target resolves its own ensure-target function',
      run: (ctx) => {
        const root = makeBrand();
        try {
          // The entry every framework exposes at ONE subpath, staged here as the
          // installed package the target's dependency declaration points at.
          jetpack.write(join(root, 'node_modules', '@omega.js', 'web', 'package.json'), { name: '@omega.js/web' });
          jetpack.write(join(root, 'node_modules', '@omega.js', 'web', 'ensure-target.js'), 'exports.ensureTarget = () => ({ written: [], merged: [], changed: [] });\n');

          const entry = discoverTargets(root).find((item) => item.name === 'web');
          const scaffold = resolveTargetScaffold(entry);

          ctx.expect(scaffold.kind).toBe('framework');
          ctx.expect(scaffold.framework).toBe('@omega.js/web');
          ctx.expect(typeof scaffold.ensureTarget).toBe('function');
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'resolveTargetScaffold: a framework exposing no ensure-target entry is an ERROR naming it',
      run: (ctx) => {
        const root = makeBrand();
        try {
          jetpack.write(join(root, 'node_modules', '@omega.js', 'web', 'package.json'), { name: '@omega.js/web' });

          const entry = discoverTargets(root).find((item) => item.name === 'web');
          const scaffold = resolveTargetScaffold(entry);

          ctx.expect(scaffold.kind).toBe('error');
          ctx.expect(scaffold.detail).toMatch(/@omega\.js\/web exposes no ensure-target entry/);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'resolveTargetScaffold: an ensure-target that THROWS at load is an ERROR naming the package',
      run: (ctx) => {
        const root = makeBrand();
        try {
          jetpack.write(join(root, 'node_modules', '@omega.js', 'web', 'package.json'), { name: '@omega.js/web' });
          jetpack.write(join(root, 'node_modules', '@omega.js', 'web', 'ensure-target.js'), 'throw new Error("boom at load");\n');

          const entry = discoverTargets(root).find((item) => item.name === 'web');
          const scaffold = resolveTargetScaffold(entry);

          ctx.expect(scaffold.kind).toBe('error');
          ctx.expect(scaffold.detail).toMatch(/@omega\.js\/web\/ensure-target failed to load: boom at load/);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'resolveTargetScaffold: a custom target has no framework scaffold, and that is a SKIP',
      run: (ctx) => {
        const root = makeBrand({ scripts: { deploy: 'render deploy' } });
        try {
          const entry = discoverTargets(root).find((item) => item.name === 'api');
          const scaffold = resolveTargetScaffold(entry);

          ctx.expect(scaffold.kind).toBe('skip');
          ctx.expect(scaffold.detail).toMatch(/no framework scaffold/);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'custom-target: --target= addresses a custom target by name',
      run: (ctx) => {
        const { selected } = selectTargets({
          targets: [{ name: 'api', target: null, custom: true }, { name: 'web', target: 'web' }],
          target: 'api',
        });

        ctx.expect(selected.map((entry) => entry.name)).toEqual(['api']);
      },
    },
  ],
});

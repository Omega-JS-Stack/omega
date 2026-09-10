/**
 * Custom targets (#603) — a brand target the framework does not own (a Render
 * API, a worker, a script), declared `targets.<name>: { type: 'custom' }` and
 * driven ENTIRELY by its own package.json scripts.
 *
 * What the contract promises, and what these tests hold it to:
 *   - config accepts the key (object and array/multi-instance form) only when
 *     it declares `type: 'custom'`; a stray unknown key is still an error;
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
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { validateConfig } = require('@omega.js/config/validate');
const { customTargetNames, customTargetDirs, targetScripts } = require('../src/lib/custom-target.js');
const { discoverTargets } = require('../src/lib/brand.js');
const { resolveTargetRun } = require('../src/lib/framework-bin.js');
const ensureStructure = require('../src/services/workspace/ensure/structure.js');
const { selectDevTargets } = require('../src/commands/dev.js');
const { selectTargets } = require('../src/commands/deploy.js');

const BASE = { brand: { id: 'b', name: 'B', url: 'https://b.test' } };

/**
 * A brand monorepo on disk with a website target and a custom `api` target
 * whose package.json carries `scripts`.
 */
function makeBrand({ scripts = {}, targets = { web: {}, api: { type: 'custom' } }, dirs = ['website', 'api'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omega-custom-'));
  jetpack.write(join(root, 'config', 'omega.json5'), JSON.stringify({ ...BASE, targets }, null, 2));
  jetpack.write(join(root, 'package.json'), { name: 'b', workspaces: ['targets/*'] });

  for (const dir of dirs) {
    jetpack.write(join(root, 'targets', dir, 'package.json'), {
      name: dir,
      ...(dir === 'website' ? { dependencies: { '@omega.js/web': '*' } } : { scripts }),
    });
  }

  return root;
}

// ─── config: the target type ─────────────────────────────────────────────────

test('config: targets.<name> with type custom is a valid target key', () => {
  const { errors } = validateConfig({ ...BASE, targets: { web: {}, api: { type: 'custom' } } });
  assert.deepEqual(errors, []);
});

test('config: the array form declares custom instances, each carrying the type', () => {
  const { errors } = validateConfig({
    ...BASE,
    targets: { api: [{ id: 'main', type: 'custom' }, { id: 'worker', type: 'custom' }] },
  });
  assert.deepEqual(errors, []);
});

test('config: an unknown target key WITHOUT type custom is still an error', () => {
  const { errors } = validateConfig({ ...BASE, targets: { api: {} } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /config\.targets\.api/);
  assert.match(errors[0], /type: 'custom'/);
});

test('config: a custom instance array where one entry forgets the type is an error', () => {
  const { errors } = validateConfig({
    ...BASE,
    targets: { api: [{ id: 'main', type: 'custom' }, { id: 'worker' }] },
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /type: 'custom'/);
});

test('config: a FRAMEWORK target may not declare itself custom', () => {
  const { errors } = validateConfig({ ...BASE, targets: { web: { type: 'custom' } } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /config\.targets\.web/);
});

// ─── discovery ───────────────────────────────────────────────────────────────

test('custom-target: the declared names and their dirs come off the config', () => {
  const config = { ...BASE, targets: { web: {}, api: { type: 'custom' }, jobs: [{ id: 'main', type: 'custom' }, { id: 'nightly', type: 'custom' }] } };

  assert.deepEqual(customTargetNames(config), ['api', 'jobs']);
  // The multi-instance mapping is the shared one: main → the bare dir, any
  // other id → <name>-<id>
  assert.deepEqual(customTargetDirs(config), ['api', 'jobs', 'jobs-nightly']);
});

test('custom-target: discoverTargets marks the dir custom instead of leaving it unmapped', () => {
  const root = makeBrand();
  try {
    const found = discoverTargets(root);
    const api = found.find((entry) => entry.name === 'api');

    assert.equal(api.custom, true);
    // `target` stays null so every existing framework-service filter
    // (`entry.target`) skips it by construction
    assert.equal(api.target, null);
    assert.equal(found.find((entry) => entry.name === 'website').custom, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── the verbs ───────────────────────────────────────────────────────────────

test('custom-target: a target with no package.json scripts declares no verbs', () => {
  const root = makeBrand({ scripts: {} });
  try {
    const entry = discoverTargets(root).find((item) => item.name === 'api');
    assert.deepEqual(targetScripts(entry.path), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── service ops: skipped, except workspace ──────────────────────────────────

test('custom-target: the workspace structure check recognizes the dir, never warns it unmapped', async () => {
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
        config: { ...BASE, targets: { web: {}, api: { type: 'custom' } } },
        enabledTargets: ['web', 'api'],
      },
      targets,
      options: {},
    });

    assert.notEqual(result.status, 'error');
    assert.doesNotMatch(lines.join('\n'), /maps to no target/);
    // The declared custom target with no dir IS still a problem, same as a
    // framework target's — proven below
  } finally {
    console.log = original;
    rmSync(root, { recursive: true, force: true });
  }
});

test('custom-target: a declared custom target with no dir is reported like any other', async () => {
  const root = makeBrand({ dirs: ['website'] });
  try {
    const result = await ensureStructure({
      brandRoot: root,
      brand: {
        root,
        config: { ...BASE, targets: { web: {}, api: { type: 'custom' } } },
        enabledTargets: ['web', 'api'],
      },
      targets: discoverTargets(root),
      options: {},
    });

    assert.equal(result.status, 'error');
    assert.match(result.error, /targets\/api/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── the dev fan-out ─────────────────────────────────────────────────────────

test('custom-target: omega dev boots the custom target beside the framework legs', () => {
  const { selected } = selectDevTargets({ available: ['web', 'backend', 'api'], custom: ['api'] });
  assert.deepEqual(selected.sort(), ['api', 'backend', 'web']);
});

test('custom-target: --target= still narrows to one custom leg', () => {
  const { selected, missing } = selectDevTargets({ available: ['web', 'api'], custom: ['api'], target: 'api' });
  assert.deepEqual(selected, ['api']);
  assert.deepEqual(missing, []);
});

test('custom-target: a custom target with no start script is not a dev leg — naming it stops the boot', () => {
  assert.throws(
    () => selectDevTargets({ available: ['web'], custom: [], target: 'api' }),
    (error) => {
      assert.equal(error.refusal, true);
      assert.match(error.message, /Unknown --target token "api"/);
      return true;
    },
  );
});

// ─── the deploy / test fan-outs ──────────────────────────────────────────────

test('custom-target: the brand deploy fan-out includes custom targets, LAST', () => {
  const { selected } = selectTargets({
    targets: [
      { name: 'api', target: null, custom: true },
      { name: 'website', target: 'web' },
      { name: 'backend', target: 'backend' },
    ],
  });

  // Framework order is unchanged and custom targets deploy after them — the
  // brand's own services depend on the API being live, never the reverse
  assert.deepEqual(selected.map((entry) => entry.name), ['backend', 'website', 'api']);
});

test('custom-target: the fan-outs run a custom target\'s own script, never a framework bin', () => {
  const root = makeBrand({ scripts: { deploy: 'render deploy', test: 'node --test' } });
  try {
    const entry = discoverTargets(root).find((item) => item.name === 'api');

    const deploy = resolveTargetRun(entry, 'deploy', ['--dry-run']);
    assert.equal(deploy.kind, 'custom');
    assert.equal(deploy.command, 'npm');
    // Framework flags are NOT forwarded — a custom script has no contract for them
    assert.deepEqual(deploy.args, ['run', 'deploy']);
    assert.equal(deploy.label, 'npm run deploy');

    // An absent verb is the loud skip, never an error
    const clean = resolveTargetRun(entry, 'clean', []);
    assert.equal(clean.kind, 'skip');
    assert.match(clean.detail, /no "clean" script/);

    // A DRY RUN must never execute a custom script: the flag it would have
    // needed to honor is exactly the one that is not forwarded
    const dry = resolveTargetRun(entry, 'deploy', ['--dry-run'], { dryRun: true });
    assert.equal(dry.kind, 'plan');
    assert.match(dry.detail, /npm run deploy/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('custom-target: --target= addresses a custom target by name', () => {
  const { selected } = selectTargets({
    targets: [{ name: 'api', target: null, custom: true }, { name: 'website', target: 'web' }],
    target: 'api',
  });

  assert.deepEqual(selected.map((entry) => entry.name), ['api']);
});

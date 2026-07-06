/**
 * Loader tests for @omegajs/config — file discovery (standalone + standalone
 * backend + brand monorepo), the five-layer resolution chain, targets
 * semantics, and the raw-file hard fails (secrets, legacy targets array).
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * devkit test convention.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig, hasOmegaConfig, resolveConfigPath, getEnabledTargets } = require('../src/index.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// Build a fixture tree ({ 'relative/path': contents }) and return its root.
function makeFixture(name, files) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

function cleanup(t, root) {
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
}

// ─── Discovery ───

test('standalone project: config/omega.json5, JSON5 syntax (comments, trailing commas, unquoted keys)', (t) => {
  const root = makeFixture('standalone', {
    'config/omega.json5': `{
      // JSON5 — strict JSON.parse would fail here
      brand: { id: 'acme', name: 'Acme' },
      targets: { desktop: { startup: { mode: 'hidden' } }, },
    }`,
  });
  cleanup(t, root);

  assert.strictEqual(hasOmegaConfig(root), true);

  const { config, errors, enabled, files } = loadConfig(root, 'desktop');
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(enabled, true);
  assert.strictEqual(config.brand.name, 'Acme');
  assert.strictEqual(config.startup.mode, 'hidden');
  assert.strictEqual(files.app, path.join(root, 'config', 'omega.json5'));
  assert.strictEqual(files.brand, null);
});

test('standalone backend: functions/config/omega.json5 is discovered; config/ wins when both exist', (t) => {
  const root = makeFixture('backend-standalone', {
    'functions/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme Backend' }, targets: { backend: {} } }`,
  });
  cleanup(t, root);

  assert.strictEqual(resolveConfigPath(root), path.join(root, 'functions', 'config', 'omega.json5'));
  assert.strictEqual(loadConfig(root, 'backend').enabled, true);

  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{ brand: { id: 'acme', name: 'Root Wins' } }`);
  assert.strictEqual(resolveConfigPath(root), path.join(root, 'config', 'omega.json5'));
});

test('missing config: hasOmegaConfig false (dual-read probe), loadConfig throws', (t) => {
  const root = makeFixture('empty', { 'package.json': '{}' });
  cleanup(t, root);

  assert.strictEqual(hasOmegaConfig(root), false);
  assert.throws(() => loadConfig(root, 'web'), /No omega\.json5 found/);
});

test('unknown target argument throws', (t) => {
  const root = makeFixture('bad-target', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' } }`,
  });
  cleanup(t, root);

  assert.throws(() => loadConfig(root, 'website'), /Unknown target "website"/);
});

test('unparseable file throws with the file path in the message', (t) => {
  const root = makeFixture('broken', { 'config/omega.json5': `{ brand: {` });
  cleanup(t, root);

  assert.throws(() => loadConfig(root, 'web'), /Failed to parse .*omega\.json5/);
});

// ─── Brand-monorepo hierarchy ───

// One probe key set at every layer proves the full chain order; sibling keys
// prove each layer actually contributes (nothing is dropped, only overridden).
const BRAND_MONOREPO = {
  'config/omega.json5': `{
    brand: { id: 'acme', name: 'Acme' },
    sentry: { dsn: 'https://brand-shared.example.com' },
    probe: { value: 'brand-shared', fromBrandShared: true },
    targets: {
      backend: { probe: { value: 'brand-target', fromBrandTarget: true }, github: { user: 'acme-org' } },
      web: {},
    },
  }`,
  'apps/backend/config/omega.json5': `{
    probe: { value: 'app-shared', fromAppShared: true },
    targets: {
      backend: {
        probe: { value: 'app-target', fromAppTarget: true },
        sentry: { dsn: 'https://backend-override.example.com' },
      },
    },
  }`,
};

test('five-layer chain: defaults < brand shared < brand target < app shared < app target', (t) => {
  const root = makeFixture('brand-monorepo', BRAND_MONOREPO);
  cleanup(t, root);

  const appDir = path.join(root, 'apps', 'backend');
  const defaults = { probe: { value: 'defaults', fromDefaults: true }, theme: { id: 'classy' } };
  const { config, errors, enabled, files } = loadConfig(appDir, 'backend', { defaults });

  assert.deepStrictEqual(errors, []);
  assert.strictEqual(enabled, true);
  assert.strictEqual(files.brand, path.join(root, 'config', 'omega.json5'));

  // Precedence: the last layer that sets probe.value wins
  assert.strictEqual(config.probe.value, 'app-target');
  // ...but every layer's unique keys survive the merge
  assert.strictEqual(config.probe.fromDefaults, true);
  assert.strictEqual(config.probe.fromBrandShared, true);
  assert.strictEqual(config.probe.fromBrandTarget, true);
  assert.strictEqual(config.probe.fromAppShared, true);
  assert.strictEqual(config.theme.id, 'classy');

  // Brand identity flows down; target-section keys land at the top level
  assert.strictEqual(config.brand.id, 'acme');
  assert.strictEqual(config.github.user, 'acme-org');
});

test('any shared key inside a target entry overrides the shared value for that surface', (t) => {
  const root = makeFixture('target-override', BRAND_MONOREPO);
  cleanup(t, root);

  const appDir = path.join(root, 'apps', 'backend');
  assert.strictEqual(loadConfig(appDir, 'backend').config.sentry.dsn, 'https://backend-override.example.com');

  // A different target (or the brand root itself) still sees the shared value
  assert.strictEqual(loadConfig(root, 'web').config.sentry.dsn, 'https://brand-shared.example.com');
});

test('resolved config keeps the merged targets map — enablement survives resolution', (t) => {
  const root = makeFixture('targets-map', BRAND_MONOREPO);
  cleanup(t, root);

  const { config, enabled } = loadConfig(path.join(root, 'apps', 'backend'), 'backend');
  assert.deepStrictEqual(getEnabledTargets(config).sort(), ['backend', 'web']);
  assert.strictEqual(enabled, true);

  // A target the brand never listed resolves with enabled: false
  assert.strictEqual(loadConfig(path.join(root, 'apps', 'backend'), 'desktop').enabled, false);
});

test('no target: whole files merge (targets map included) — the disperse shape; enabled is null', (t) => {
  const root = makeFixture('no-target', BRAND_MONOREPO);
  cleanup(t, root);

  const { config, enabled } = loadConfig(path.join(root, 'apps', 'backend'));
  assert.strictEqual(enabled, null);
  assert.strictEqual(config.probe.value, 'app-shared');
  assert.strictEqual(config.targets.backend.probe.value, 'app-target');
  assert.strictEqual(config.targets.backend.github.user, 'acme-org');
  assert.deepStrictEqual(config.targets.web, {});
});

test('backend runtime cwd (the functions/ dir) still walks up to the brand config', (t) => {
  // BEM's Manager boots with cwd = {brand}/apps/backend/functions — the app
  // root is one up, and the brand layer must still resolve from there.
  const root = makeFixture('functions-cwd', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      firebaseConfig: { projectId: 'acme-prod' },
      targets: { backend: {} },
    }`,
    'apps/backend/functions/config/omega.json5': `{
      targets: { backend: { github: { user: 'acme-org' } } },
    }`,
  });
  cleanup(t, root);

  const functionsDir = path.join(root, 'apps', 'backend', 'functions');
  const fromFunctions = loadConfig(functionsDir, 'backend');
  assert.strictEqual(fromFunctions.files.brand, path.join(root, 'config', 'omega.json5'));
  assert.strictEqual(fromFunctions.config.firebaseConfig.projectId, 'acme-prod');
  assert.strictEqual(fromFunctions.config.github.user, 'acme-org');
  assert.strictEqual(fromFunctions.enabled, true);

  // Same resolution from the app root — both entry points agree
  const fromAppRoot = loadConfig(path.join(root, 'apps', 'backend'), 'backend');
  assert.deepStrictEqual(fromAppRoot.config, fromFunctions.config);
});

test('an apps/ dir without a brand-level config is standalone — no walk-up', (t) => {
  const root = makeFixture('no-brand-config', {
    'apps/backend/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { backend: {} } }`,
  });
  cleanup(t, root);

  const { files } = loadConfig(path.join(root, 'apps', 'backend'), 'backend');
  assert.strictEqual(files.brand, null);
});

// ─── Raw-file hard fails ───

test('secrets throw even in a NON-requested target section', (t) => {
  const root = makeFixture('secret-other-target', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      targets: { backend: {}, desktop: { updater: { signingSecret: 'x' } } },
    }`,
  });
  cleanup(t, root);

  assert.throws(
    () => loadConfig(root, 'backend'),
    /Secret-shaped keys in .*omega\.json5 .* targets\.desktop\.updater\.signingSecret/,
  );
});

test('secrets in the brand file throw when loading an app', (t) => {
  const root = makeFixture('secret-brand', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, stripeSecret: 'x' }`,
    'apps/web/config/omega.json5': `{ targets: { web: {} } }`,
  });
  cleanup(t, root);

  assert.throws(() => loadConfig(path.join(root, 'apps', 'web'), 'web'), /stripeSecret/);
});

test('legacy targets ARRAY throws loudly instead of mangling into {0: ...}', (t) => {
  const root = makeFixture('legacy-targets', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: ['web', 'backend'] }`,
  });
  cleanup(t, root);

  assert.throws(() => loadConfig(root, 'web'), /legacy array form is not valid omega\.json5/);
});

// ─── Validation pass-through ───

test('schema findings come back as errors, never thrown — callers pick their strictness', (t) => {
  const root = makeFixture('soft-errors', {
    'config/omega.json5': `{ brand: { id: 'Not A Slug' }, theme: { appearance: 'neon' } }`,
  });
  cleanup(t, root);

  const { errors } = loadConfig(root, 'web');
  assert.ok(errors.some((e) => e.includes('config.brand.name is required')));
  assert.ok(errors.some((e) => e.includes('config.brand.id') && e.includes('does not match')));
  assert.ok(errors.some((e) => e.includes('config.theme.appearance')));
});

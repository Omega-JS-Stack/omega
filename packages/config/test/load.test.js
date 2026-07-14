/**
 * Loader tests for @omega.js/config — file discovery (standalone + standalone
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

const { loadConfig, composeTargetConfig, hasOmegaConfig, resolveConfigPath, getEnabledTargets, resolveBrandRoot } = require('../src/index.js');

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

test('backend app dir: a STAGED functions/config is never the app layer; the functions dir itself still resolves it (runtime view)', (t) => {
  // src/dist pillar: functions/config/omega.json5 is compose OUTPUT. From the
  // APP ROOT it must not resolve (a stale stage would shadow brand edits);
  // from the FUNCTIONS dir (the deployed runtime's cwd/projectDir) it is that
  // dir's own config/omega.json5 and resolves exactly like production.
  const root = makeFixture('backend-standalone', {
    'functions/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme Backend' }, targets: { backend: {} } }`,
  });
  cleanup(t, root);

  assert.strictEqual(resolveConfigPath(root), null);
  assert.strictEqual(hasOmegaConfig(root), false);
  assert.strictEqual(resolveConfigPath(path.join(root, 'functions')), path.join(root, 'functions', 'config', 'omega.json5'));
  assert.strictEqual(loadConfig(path.join(root, 'functions'), 'backend').enabled, true);

  // The authored standalone home is the app root — it wins the app-root view
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{ brand: { id: 'acme', name: 'Root Wins' }, targets: { backend: {} } }`);
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
    monitoring: { dsn: 'https://brand-shared.example.com' },
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
        monitoring: { dsn: 'https://backend-override.example.com' },
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
  assert.strictEqual(loadConfig(appDir, 'backend').config.monitoring.dsn, 'https://backend-override.example.com');

  // A different target (or the brand root itself) still sees the shared value
  assert.strictEqual(loadConfig(root, 'web').config.monitoring.dsn, 'https://brand-shared.example.com');
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
  // @omega.js/backend's Manager boots with cwd = {brand}/apps/backend/functions — the app
  // root is one up, and the brand layer must still resolve from there. Under
  // the src/dist pillar the app's AUTHORED file lives at the app root; the
  // functions dir carries the STAGED compose (written by omega build).
  const root = makeFixture('functions-cwd', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      cloud: { provider: 'firebase', config: { projectId: 'acme-prod' } },
      targets: { backend: {} },
    }`,
    'apps/backend/config/omega.json5': `{
      targets: { backend: { github: { user: 'acme-org' } } },
    }`,
  });
  cleanup(t, root);

  const appRoot = path.join(root, 'apps', 'backend');
  const functionsDir = path.join(appRoot, 'functions');

  // Local emulator view BEFORE any stage: the walk-up alone serves everything
  const fromFunctions = loadConfig(functionsDir, 'backend');
  assert.strictEqual(fromFunctions.files.brand, path.join(root, 'config', 'omega.json5'));
  assert.strictEqual(fromFunctions.config.cloud.config.projectId, 'acme-prod');
  assert.strictEqual(fromFunctions.config.github.user, 'acme-org');
  assert.strictEqual(fromFunctions.enabled, true);

  // Same resolution from the app root — both entry points agree
  const fromAppRoot = loadConfig(appRoot, 'backend');
  assert.deepStrictEqual(fromAppRoot.config, fromFunctions.config);

  // AFTER a stage (composed file in functions/config), the functions view
  // resolves the staged file as its own app layer and STILL agrees
  const { config: composed } = composeTargetConfig(appRoot, 'backend');
  fs.mkdirSync(path.join(functionsDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(functionsDir, 'config', 'omega.json5'), JSON.stringify(composed, null, 2));
  const staged = loadConfig(functionsDir, 'backend');
  assert.strictEqual(staged.config.github.user, 'acme-org');
  assert.strictEqual(staged.config.cloud.config.projectId, 'acme-prod');
  // ...while the app-root view IGNORES the staged file (never an app layer)
  assert.strictEqual(loadConfig(appRoot, 'backend').files.app, path.join(appRoot, 'config', 'omega.json5'));
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

// ─── resolveBrandRoot (the upward SEARCH — moved here from the manager, cp73c) ───

test('resolveBrandRoot: finds the brand root from anywhere in the tree', (t) => {
  const root = makeFixture('walk-brand', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' } }`,
    'apps/website/config/omega.json5': `{ targets: { web: {} } }`,
    'apps/website/src/lib/deep.js': `// depth fixture`,
    'apps/api/functions/config/omega.json5': `{ targets: { backend: {} } }`,
  });
  cleanup(t, root);

  // From the brand root itself
  assert.equal(resolveBrandRoot(root), root);
  // From an app dir (an app of this brand is never itself the root)
  assert.equal(resolveBrandRoot(path.join(root, 'apps', 'website')), root);
  // From deep inside an app
  assert.equal(resolveBrandRoot(path.join(root, 'apps', 'website', 'src', 'lib')), root);
  // From a backend app's functions/ dir (carries config, never a root)
  assert.equal(resolveBrandRoot(path.join(root, 'apps', 'api', 'functions')), root);
});

test('resolveBrandRoot: a standalone config-carrying project resolves to itself', (t) => {
  const root = makeFixture('walk-standalone', {
    'config/omega.json5': `{ brand: { id: 'solo', name: 'Solo' }, targets: { web: {} } }`,
    'src/pages/index.js': `// depth fixture`,
  });
  cleanup(t, root);

  assert.equal(resolveBrandRoot(root), root);
  assert.equal(resolveBrandRoot(path.join(root, 'src', 'pages')), root);
});

test('resolveBrandRoot: a brand nested inside a larger workspace apps/ dir still resolves as a brand root (sandbox shape)', (t) => {
  const workspace = makeFixture('walk-nested', {
    // No workspace-level config — apps/ here is NOT a brand's apps dir
    'apps/sandbox-brand/config/omega.json5': `{ brand: { id: 'sandbox', name: 'Sandbox' } }`,
    'apps/sandbox-brand/apps/website/config/omega.json5': `{ targets: { web: {} } }`,
  });
  cleanup(t, workspace);

  const brandRoot = path.join(workspace, 'apps', 'sandbox-brand');
  assert.equal(resolveBrandRoot(brandRoot), brandRoot);
  assert.equal(resolveBrandRoot(path.join(brandRoot, 'apps', 'website')), brandRoot);
});

test('resolveBrandRoot: null when no omega.json5 exists up the tree', (t) => {
  const root = makeFixture('walk-nothing', {
    'src/anything.js': `// no config anywhere`,
  });
  cleanup(t, root);

  assert.equal(resolveBrandRoot(path.join(root, 'src')), null);
});

// ─── composeTargetConfig (#31 — the deploy upload boundary) ───

// Brand + app fixture exercising every interleave position, INCLUDING the
// corner a naive whole-file merge gets wrong: `corner` is set by brand
// TARGET and app SHARED — locally app-shared wins (it merges later), and a
// raw merged targets map would re-apply the brand-target value above it.
const COMPOSE_TREE = {
  'config/omega.json5': `{
    brand: { id: 'acme', name: 'Acme Corp', url: 'https://acme.test' },
    shade: 'brand-shared',
    corner: 'from-brand-shared',
    targets: {
      backend: { flavor: 'from-brand-target', corner: 'from-brand-target' },
      web: {},
    },
  }`,
  'apps/api/config/omega.json5': `{
    corner: 'from-app-shared',
    targets: { backend: { flavor: 'from-app-target' } },
  }`,
};

const COMPOSE_DEFAULTS = {
  brand: { id: 'my-app', name: 'My Brand' },
  corner: 'from-defaults',
  defaultOnly: true,
};

test('composeTargetConfig: freezes the full interleave into shared, targets go presence-only', (t) => {
  const brandRoot = makeFixture('compose-tree', COMPOSE_TREE);
  cleanup(t, brandRoot);
  const appDir = path.join(brandRoot, 'apps', 'api');

  const { config, files } = composeTargetConfig(path.join(appDir, 'functions'), 'backend');

  assert.strictEqual(config.brand.name, 'Acme Corp'); // brand layer crossed the boundary
  assert.strictEqual(config.shade, 'brand-shared');
  assert.strictEqual(config.flavor, 'from-app-target'); // app target beats brand target
  assert.strictEqual(config.corner, 'from-app-shared'); // app SHARED beats brand TARGET (the interleave pin)
  assert.deepStrictEqual(config.targets, { backend: {}, web: {} }); // presence-only
  assert.strictEqual(config.defaultOnly, undefined); // defaults are NOT baked in
  assert.strictEqual(files.brand, path.join(brandRoot, 'config', 'omega.json5'));
});

test('composeTargetConfig: loading the composed file standalone resolves EXACTLY like the local walk-up (the theorem)', (t) => {
  const brandRoot = makeFixture('compose-theorem', COMPOSE_TREE);
  cleanup(t, brandRoot);
  const appDir = path.join(brandRoot, 'apps', 'api');

  const { config: composed } = composeTargetConfig(appDir, 'backend');

  // Simulate the upload boundary: the composed file alone in a fresh root
  const uploadRoot = makeFixture('compose-upload', {
    'config/omega.json5': JSON.stringify(composed, null, 2),
  });
  cleanup(t, uploadRoot);

  const local = loadConfig(appDir, 'backend', { defaults: COMPOSE_DEFAULTS });
  const viaUpload = loadConfig(uploadRoot, 'backend', { defaults: COMPOSE_DEFAULTS });

  // targets is enumeration-only ("settings are never read from it") — the
  // resolved settings and the enabled-target set must match exactly
  const { targets: localTargets, ...localConfig } = local.config;
  const { targets: uploadTargets, ...uploadConfig } = viaUpload.config;
  assert.deepStrictEqual(uploadConfig, localConfig);
  assert.deepStrictEqual(Object.keys(uploadTargets).sort(), Object.keys(localTargets).sort());
  assert.strictEqual(viaUpload.enabled, local.enabled);
  assert.deepStrictEqual(viaUpload.errors, local.errors);
});

test('composeTargetConfig: app dir and its functions/ dir compose identically; no brand layer → self-contained', (t) => {
  const brandRoot = makeFixture('compose-dirs', COMPOSE_TREE);
  cleanup(t, brandRoot);
  const appDir = path.join(brandRoot, 'apps', 'api');

  assert.deepStrictEqual(
    composeTargetConfig(appDir, 'backend').config,
    composeTargetConfig(path.join(appDir, 'functions'), 'backend').config,
  );

  const solo = makeFixture('compose-solo', {
    'config/omega.json5': `{ brand: { id: 'solo', name: 'Solo' }, targets: { backend: { flavor: 'solo-target' } } }`,
  });
  cleanup(t, solo);

  const { config, files } = composeTargetConfig(solo, 'backend');
  assert.strictEqual(files.brand, null);
  assert.strictEqual(config.flavor, 'solo-target');
});

test('composeTargetConfig: app file OPTIONAL inside a brand monorepo — brand-only compose matches loadConfig (src/dist pillar)', (t) => {
  const brandRoot = makeFixture('compose-no-app', {
    'config/omega.json5': COMPOSE_TREE['config/omega.json5'],
    'apps/api/src/index.js': `// authored tree only — no app omega.json5, no functions/ yet`,
  });
  cleanup(t, brandRoot);
  const appDir = path.join(brandRoot, 'apps', 'api');

  const { config, files } = composeTargetConfig(appDir, 'backend');
  assert.strictEqual(files.app, null); // rides the brand file alone
  assert.strictEqual(config.brand.name, 'Acme Corp');
  assert.strictEqual(config.flavor, 'from-brand-target');
  assert.strictEqual(config.corner, 'from-brand-target'); // no app layers left to beat it
  assert.deepStrictEqual(config.targets, { backend: {}, web: {} }); // presence-only

  // The theorem holds without an app file: composed-alone ≡ local walk-up,
  // and the app dir + its (future staged) functions/ dir agree.
  const uploadRoot = makeFixture('compose-no-app-upload', {
    'config/omega.json5': JSON.stringify(config, null, 2),
  });
  cleanup(t, uploadRoot);
  const local = loadConfig(appDir, 'backend', { defaults: COMPOSE_DEFAULTS });
  const viaUpload = loadConfig(uploadRoot, 'backend', { defaults: COMPOSE_DEFAULTS });
  const { targets: localTargets, ...localConfig } = local.config;
  const { targets: uploadTargets, ...uploadConfig } = viaUpload.config;
  assert.deepStrictEqual(uploadConfig, localConfig);
  assert.deepStrictEqual(Object.keys(uploadTargets).sort(), Object.keys(localTargets).sort());
  assert.deepStrictEqual(
    composeTargetConfig(appDir, 'backend').config,
    composeTargetConfig(path.join(appDir, 'functions'), 'backend').config,
  );

  // Still a hard error when NOTHING exists (standalone with no file at all)
  const empty = makeFixture('compose-empty', { 'src/index.js': `// nothing` });
  cleanup(t, empty);
  assert.throws(() => composeTargetConfig(empty, 'backend'), /No omega\.json5 found/);
});

test('composeTargetConfig: secrets in either layer hard-fail before any merge', (t) => {
  const brandRoot = makeFixture('compose-secrets', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, apiSecret: 'leaked' }`,
    'apps/api/config/omega.json5': `{ targets: { backend: {} } }`,
  });
  cleanup(t, brandRoot);

  assert.throws(
    () => composeTargetConfig(path.join(brandRoot, 'apps', 'api'), 'backend'),
    /Secret-shaped keys/,
  );
  assert.throws(() => composeTargetConfig(brandRoot, 'nope'), /Unknown target/);
});

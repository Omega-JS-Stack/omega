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

const { loadConfig, composeTargetConfig, hasOmegaConfig, resolveConfigPath, getEnabledTargets, resolveBrandRoot, recordBrand } = require('../src/index.js');

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
      targets: { desktop: { type: 'desktop', startup: { mode: 'hidden' } }, },
    }`,
  });
  cleanup(t, root);

  assert.strictEqual(hasOmegaConfig(root), true);

  const { config, errors, enabled, files } = loadConfig(root, 'desktop');
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(enabled, true);
  assert.strictEqual(config.brand.name, 'Acme');
  assert.strictEqual(config.startup.mode, 'hidden');
  assert.strictEqual(files.local, path.join(root, 'config', 'omega.json5'));
  assert.strictEqual(files.brand, null);
});

test('backend target dir: a STAGED functions/config is never the local layer; the functions dir itself still resolves it (runtime view)', (t) => {
  // src/dist pillar: functions/config/omega.json5 is compose OUTPUT. From the
  // TARGET ROOT it must not resolve (a stale stage would shadow brand edits);
  // from the FUNCTIONS dir (the deployed runtime's cwd/projectDir) it is that
  // dir's own config/omega.json5 and resolves exactly like production.
  const root = makeFixture('backend-standalone', {
    'functions/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme Backend' }, targets: { backend: { type: 'backend' } } }`,
  });
  cleanup(t, root);

  assert.strictEqual(resolveConfigPath(root), null);
  assert.strictEqual(hasOmegaConfig(root), false);
  assert.strictEqual(resolveConfigPath(path.join(root, 'functions')), path.join(root, 'functions', 'config', 'omega.json5'));
  assert.strictEqual(loadConfig(path.join(root, 'functions'), 'backend').enabled, true);

  // The authored standalone home is the target root — it wins the target-root view
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{ brand: { id: 'acme', name: 'Root Wins' }, targets: { backend: { type: 'backend' } } }`);
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
    monitoring: { providers: { sentry: { dsn: 'https://brand-shared.example.com' } } },
    probe: { value: 'brand-shared', fromBrandShared: true },
    targets: {
      backend: { type: 'backend', probe: { value: 'brand-target', fromBrandTarget: true }, repo: { org: 'acme-org' } },
      web: { type: 'web' },
    },
  }`,
  'targets/backend/config/omega.json5': `{
    probe: { value: 'local-shared', fromLocalShared: true },
    targets: {
      backend: { type: 'backend',
        probe: { value: 'local-target', fromLocalTarget: true },
        monitoring: { providers: { sentry: { dsn: 'https://backend-override.example.com' } } },
      },
    },
  }`,
};

test('five-layer chain: defaults < brand shared < brand target < local shared < local target', (t) => {
  const root = makeFixture('brand-monorepo', BRAND_MONOREPO);
  cleanup(t, root);

  const targetDir = path.join(root, 'targets', 'backend');
  const defaults = { probe: { value: 'defaults', fromDefaults: true }, theme: { id: 'classy' } };
  const { config, errors, enabled, files } = loadConfig(targetDir, 'backend', { defaults });

  assert.deepStrictEqual(errors, []);
  assert.strictEqual(enabled, true);
  assert.strictEqual(files.brand, path.join(root, 'config', 'omega.json5'));

  // Precedence: the last layer that sets probe.value wins
  assert.strictEqual(config.probe.value, 'local-target');
  // ...but every layer's unique keys survive the merge
  assert.strictEqual(config.probe.fromDefaults, true);
  assert.strictEqual(config.probe.fromBrandShared, true);
  assert.strictEqual(config.probe.fromBrandTarget, true);
  assert.strictEqual(config.probe.fromLocalShared, true);
  assert.strictEqual(config.theme.id, 'classy');

  // Brand identity flows down; target-section keys land at the top level
  assert.strictEqual(config.brand.id, 'acme');
  assert.strictEqual(config.repo.org, 'acme-org');
});

test('any shared key inside a target entry overrides the shared value for that surface', (t) => {
  const root = makeFixture('target-override', BRAND_MONOREPO);
  cleanup(t, root);

  const targetDir = path.join(root, 'targets', 'backend');
  assert.strictEqual(loadConfig(targetDir, 'backend').config.monitoring.providers.sentry.dsn, 'https://backend-override.example.com');

  // A different target (or the brand root itself) still sees the shared value
  assert.strictEqual(loadConfig(root, 'web').config.monitoring.providers.sentry.dsn, 'https://brand-shared.example.com');
});

test('the six manager-level sections resolve shared, and a targets.backend block still overrides them (#277)', (t) => {
  const root = makeFixture('manager-sections-shared', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      directory: { enabled: true },
      repo: { org: 'acme-org' },
      reviews: { enabled: true, sites: ['trustpilot.com'] },
      marketing: { campaigns: { enabled: true, providers: { sendgrid: { listId: 'lst_shared' } } } },
      blog: { enabled: false },
      dataRequest: { queries: [] },
      targets: {
        web: { type: 'web' },
        backend: { type: 'backend', directory: { enabled: false }, marketing: { campaigns: { providers: { sendgrid: { listId: 'lst_backend' } } } } },
      },
    }`,
  });
  cleanup(t, root);

  // The manager reads the brand config UNFOLDED (no target), so the shared level is its home
  const brandView = loadConfig(root);
  assert.deepStrictEqual(brandView.errors, []);
  assert.strictEqual(brandView.config.directory.enabled, true);
  assert.strictEqual(brandView.config.marketing.campaigns.providers.sendgrid.listId, 'lst_shared');
  assert.strictEqual(brandView.config.reviews.sites[0], 'trustpilot.com');

  // A website-only surface sees the shared values, and they validate there
  const webView = loadConfig(root, 'web');
  assert.deepStrictEqual(webView.errors, []);
  assert.strictEqual(webView.config.directory.enabled, true);
  assert.strictEqual(webView.config.blog.enabled, false);

  // targets.backend stays a valid OVERRIDE via the existing merge chain, with no schema of its own
  const backendView = loadConfig(root, 'backend');
  assert.deepStrictEqual(backendView.errors, []);
  assert.strictEqual(backendView.config.directory.enabled, false);
  assert.strictEqual(backendView.config.marketing.campaigns.providers.sendgrid.listId, 'lst_backend');
  // ...and the shared keys the override did not touch survive it
  assert.strictEqual(backendView.config.marketing.campaigns.enabled, true);
  assert.strictEqual(backendView.config.repo.org, 'acme-org');
});

test('resolved config keeps the merged targets map — enablement survives resolution', (t) => {
  const root = makeFixture('targets-map', BRAND_MONOREPO);
  cleanup(t, root);

  const { config, enabled } = loadConfig(path.join(root, 'targets', 'backend'), 'backend');
  assert.deepStrictEqual(getEnabledTargets(config).sort(), ['backend', 'web']);
  assert.strictEqual(enabled, true);

  // A target the brand never listed resolves with enabled: false
  assert.strictEqual(loadConfig(path.join(root, 'targets', 'desktop'), 'desktop').enabled, false);
});

test('#886: a STANDALONE project is named by its file, not by the type word', (t) => {
  // The deployed shape: a brand staged its `api` backend, so the upload carries
  // `api: { type: 'backend' }` and no brand root above it. The name has to come
  // back out of the file, or the entry stops being the target layer.
  const root = makeFixture('standalone-named-target', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
      targets: {
        api: { type: 'backend', flavor: 'api-target' },
        web: { type: 'web' },
      },
    }`,
  });
  cleanup(t, root);

  const api = loadConfig(root, 'backend');
  assert.deepStrictEqual(api.errors, []);
  assert.strictEqual(api.name, 'api');
  assert.strictEqual(api.enabled, true);
  assert.strictEqual(api.config.flavor, 'api-target', 'the named entry is still the target layer');
  assert.strictEqual(api.config.url, 'https://api.acme.test', 'and its url derives exactly as it does inside the brand');

  // A type with no declared target at all keeps the type word
  assert.strictEqual(loadConfig(root, 'desktop').name, 'desktop');
  assert.strictEqual(loadConfig(root, 'desktop').enabled, false);

  // Two targets of one type have no single answer, so the type word stands
  const twins = makeFixture('standalone-two-of-a-type', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      targets: { web: { type: 'web' }, community: { type: 'web' } },
    }`,
  });
  cleanup(t, twins);
  assert.strictEqual(loadConfig(twins, 'web').name, 'web');
});

test('#886: a target dir whose entry runs a different framework is a loud error', (t) => {
  const root = makeFixture('targets-type-mismatch', BRAND_MONOREPO);
  cleanup(t, root);

  assert.throws(
    () => loadConfig(path.join(root, 'targets', 'backend'), 'desktop'),
    /targets\.backend is type backend; this project runs the desktop framework/,
  );
});

test('#886: the target dir NAMES the entry, so a second web target merges its own layer', (t) => {
  const root = makeFixture('targets-by-name', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
      monitoring: { providers: { sentry: { dsn: 'https://brand-shared.example.com' } } },
      targets: {
        web: { type: 'web', flavor: 'primary' },
        admin: {
          type: 'web',
          flavor: 'console',
          brand: { name: 'Acme Admin' },
          monitoring: { providers: { sentry: { dsn: 'https://admin-override.example.com' } } },
        },
        backend: { type: 'backend' },
      },
    }`,
    'targets/web/package.json': '{}',
    'targets/admin/package.json': '{}',
  });
  cleanup(t, root);

  const main = loadConfig(path.join(root, 'targets', 'web'), 'web');
  assert.deepStrictEqual(main.errors, []);
  assert.strictEqual(main.name, 'web');
  assert.strictEqual(main.enabled, true);
  assert.strictEqual(main.config.flavor, 'primary');
  assert.strictEqual(main.config.brand.name, 'Acme');
  assert.strictEqual(main.config.url, undefined, 'a target named for its type derives nothing: brand.url IS its url');

  const admin = loadConfig(path.join(root, 'targets', 'admin'), 'web');
  assert.strictEqual(admin.name, 'admin');
  assert.strictEqual(admin.enabled, true);
  assert.strictEqual(admin.config.flavor, 'console', 'the NAMED entry is the target layer');
  assert.strictEqual(admin.config.brand.name, 'Acme Admin', 'a shared key inside the entry overrides brand shared for that target');
  assert.strictEqual(admin.config.brand.url, 'https://acme.test', 'sibling shared keys survive the merge');
  assert.strictEqual(admin.config.monitoring.providers.sentry.dsn, 'https://admin-override.example.com');
  assert.strictEqual(admin.config.url, 'https://admin.acme.test', 'the name IS the subdomain');

  // The TARGET_SUBDIR views of the same target resolve the same name
  for (const subdir of ['functions', 'dist']) {
    const staged = loadConfig(path.join(root, 'targets', 'admin', subdir), 'web');
    assert.strictEqual(staged.name, 'admin', `${subdir}/ resolves its target dir's name`);
    assert.strictEqual(staged.config.flavor, 'console');
  }

  // A standalone project is named by the framework it runs
  const solo = makeFixture('targets-by-name-solo', {
    'config/omega.json5': `{ brand: { id: 'solo', name: 'Solo' }, targets: { web: { type: 'web', flavor: 'only' } } }`,
  });
  cleanup(t, solo);
  assert.strictEqual(loadConfig(solo, 'web').name, 'web');
  assert.strictEqual(loadConfig(solo, 'web').config.flavor, 'only');
});

test('no target: whole files merge (targets map included) — the disperse shape; enabled is null', (t) => {
  const root = makeFixture('no-target', BRAND_MONOREPO);
  cleanup(t, root);

  const { config, enabled } = loadConfig(path.join(root, 'targets', 'backend'));
  assert.strictEqual(enabled, null);
  assert.strictEqual(config.probe.value, 'local-shared');
  assert.strictEqual(config.targets.backend.probe.value, 'local-target');
  assert.strictEqual(config.targets.backend.repo.org, 'acme-org');
  assert.deepStrictEqual(config.targets.web, { type: 'web' });
});

test('backend runtime cwd (the functions/ dir) still walks up to the brand config', (t) => {
  // @omega.js/backend's Manager boots with cwd = {brand}/targets/backend/functions — the target
  // root is one up, and the brand layer must still resolve from there. Under
  // the src/dist pillar the target's AUTHORED file lives at the target root; the
  // functions dir carries the STAGED compose (written by omega build).
  const root = makeFixture('functions-cwd', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      cloud: { provider: 'firebase', config: { projectId: 'acme-prod' } },
      targets: { backend: { type: 'backend' } },
    }`,
    'targets/backend/config/omega.json5': `{
      targets: { backend: { type: 'backend', repo: { org: 'acme-org' } } },
    }`,
  });
  cleanup(t, root);

  const targetRoot = path.join(root, 'targets', 'backend');
  const functionsDir = path.join(targetRoot, 'functions');

  // Local emulator view BEFORE any stage: the walk-up alone serves everything
  const fromFunctions = loadConfig(functionsDir, 'backend');
  assert.strictEqual(fromFunctions.files.brand, path.join(root, 'config', 'omega.json5'));
  assert.strictEqual(fromFunctions.config.cloud.config.projectId, 'acme-prod');
  assert.strictEqual(fromFunctions.config.repo.org, 'acme-org');
  assert.strictEqual(fromFunctions.enabled, true);

  // Same resolution from the target root — both entry points agree
  const fromTargetRoot = loadConfig(targetRoot, 'backend');
  assert.deepStrictEqual(fromTargetRoot.config, fromFunctions.config);

  // AFTER a stage (composed file in functions/config), the functions view
  // resolves the staged file as its own local layer and STILL agrees
  const { config: composed } = composeTargetConfig(targetRoot, 'backend');
  fs.mkdirSync(path.join(functionsDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(functionsDir, 'config', 'omega.json5'), JSON.stringify(composed, null, 2));
  const staged = loadConfig(functionsDir, 'backend');
  assert.strictEqual(staged.config.repo.org, 'acme-org');
  assert.strictEqual(staged.config.cloud.config.projectId, 'acme-prod');
  // ...while the target-root view IGNORES the staged file (never a local layer)
  assert.strictEqual(loadConfig(targetRoot, 'backend').files.local, path.join(targetRoot, 'config', 'omega.json5'));
});

test('a targets/ dir without a brand-level config is standalone — no walk-up', (t) => {
  const root = makeFixture('no-brand-config', {
    'targets/backend/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { backend: { type: 'backend' } } }`,
  });
  cleanup(t, root);

  const { files } = loadConfig(path.join(root, 'targets', 'backend'), 'backend');
  assert.strictEqual(files.brand, null);
});

// ─── Raw-file hard fails ───

test('secrets throw even in a NON-requested target section', (t) => {
  const root = makeFixture('secret-other-target', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      targets: { backend: { type: 'backend' }, desktop: { type: 'desktop', updater: { signingSecret: 'x' } } },
    }`,
  });
  cleanup(t, root);

  assert.throws(
    () => loadConfig(root, 'backend'),
    /Secret-shaped keys in .*omega\.json5 .* targets\.desktop\.updater\.signingSecret/,
  );
});

test('secrets in the brand file throw when loading a target', (t) => {
  const root = makeFixture('secret-brand', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, stripeSecret: 'x' }`,
    'targets/web/config/omega.json5': `{ targets: { web: { type: 'web' } } }`,
  });
  cleanup(t, root);

  assert.throws(() => loadConfig(path.join(root, 'targets', 'web'), 'web'), /stripeSecret/);
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
    'targets/web/config/omega.json5': `{ targets: { web: { type: 'web' } } }`,
    'targets/web/src/lib/deep.js': `// depth fixture`,
    'targets/api/functions/config/omega.json5': `{ targets: { backend: { type: 'backend' } } }`,
  });
  cleanup(t, root);

  // From the brand root itself
  assert.equal(resolveBrandRoot(root), root);
  // From a target dir (a target of this brand is never itself the root)
  assert.equal(resolveBrandRoot(path.join(root, 'targets', 'web')), root);
  // From deep inside a target
  assert.equal(resolveBrandRoot(path.join(root, 'targets', 'web', 'src', 'lib')), root);
  // From a backend target's functions/ dir (carries config, never a root)
  assert.equal(resolveBrandRoot(path.join(root, 'targets', 'api', 'functions')), root);
});

test('resolveBrandRoot: a pre-#443 apps/ brand still resolves to its TRUE root from a config-carrying target', (t) => {
  // Detection, not compatibility: the walk must climb past a legacy target so
  // discovery fails loud at the real root with the targets-rename pointer.
  // Stopping at the target loaded IT as the brand, and the rename migration
  // run from that cwd reported "already on targets/" without touching apps/.
  const root = makeFixture('walk-legacy-apps', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' } }`,
    'apps/website/config/omega.json5': `{ targets: { web: { type: 'web' } } }`,
  });
  cleanup(t, root);

  assert.equal(resolveBrandRoot(path.join(root, 'apps', 'website')), root);
});

test('resolveBrandRoot: a standalone config-carrying project resolves to itself', (t) => {
  const root = makeFixture('walk-standalone', {
    'config/omega.json5': `{ brand: { id: 'solo', name: 'Solo' }, targets: { web: { type: 'web' } } }`,
    'src/pages/index.js': `// depth fixture`,
  });
  cleanup(t, root);

  assert.equal(resolveBrandRoot(root), root);
  assert.equal(resolveBrandRoot(path.join(root, 'src', 'pages')), root);
});

test('resolveBrandRoot: a STAGED dist/ is never a root — its target dir (and the brand above it) is', (t) => {
  // dist/config/omega.json5 is compose OUTPUT, the same shape functions/ has
  // carried since the src/dist pillar. The walk skipped only `functions`, so
  // a resolution from a staged dist/ stopped there and named the build output
  // as the project root ([#299](https://github.com/Omega-JS-Stack/omega/issues/299)).
  const root = makeFixture('walk-staged-dist', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' } }`,
    'targets/backend/config/omega.json5': `{ targets: { backend: { type: 'backend' } } }`,
    'targets/backend/dist/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { backend: { type: 'backend' } } }`,
  });
  cleanup(t, root);

  assert.equal(resolveBrandRoot(path.join(root, 'targets', 'backend', 'dist')), root);

  // Standalone: the project root, never its own staged output
  const standalone = makeFixture('walk-staged-dist-standalone', {
    'config/omega.json5': `{ brand: { id: 'solo', name: 'Solo' }, targets: { backend: { type: 'backend' } } }`,
    'dist/config/omega.json5': `{ brand: { id: 'solo', name: 'Solo' }, targets: { backend: { type: 'backend' } } }`,
  });
  cleanup(t, standalone);

  assert.equal(resolveBrandRoot(path.join(standalone, 'dist')), standalone);
});

test('resolveBrandRoot: a brand nested inside a larger workspace targets/ dir still resolves as a brand root (sandbox shape)', (t) => {
  const workspace = makeFixture('walk-nested', {
    // No workspace-level config — targets/ here is NOT a brand's targets dir
    'targets/sandbox-brand/config/omega.json5': `{ brand: { id: 'sandbox', name: 'Sandbox' } }`,
    'targets/sandbox-brand/targets/web/config/omega.json5': `{ targets: { web: { type: 'web' } } }`,
  });
  cleanup(t, workspace);

  const brandRoot = path.join(workspace, 'targets', 'sandbox-brand');
  assert.equal(resolveBrandRoot(brandRoot), brandRoot);
  assert.equal(resolveBrandRoot(path.join(brandRoot, 'targets', 'web')), brandRoot);
});

test('resolveBrandRoot: null when no omega.json5 exists up the tree', (t) => {
  const root = makeFixture('walk-nothing', {
    'src/anything.js': `// no config anywhere`,
  });
  cleanup(t, root);

  assert.equal(resolveBrandRoot(path.join(root, 'src')), null);
});

test('resolveBrandRoot: the walk stops at the nearest .git — an unconfigured repo never adopts a config above it (#73)', (t) => {
  // The outer dir carries a brand config; the inner repo carries none. An
  // unbounded walk would climb out of the repo and claim the outer brand.
  const outer = makeFixture('walk-git-bound', {
    'config/omega.json5': `{ brand: { id: 'outer', name: 'Outer' } }`,
    'repo/.git/HEAD': `ref: refs/heads/main`,
    'repo/src/lib/deep.js': `// depth fixture`,
  });
  cleanup(t, outer);

  assert.equal(resolveBrandRoot(path.join(outer, 'repo', 'src', 'lib')), null);
  assert.equal(resolveBrandRoot(path.join(outer, 'repo')), null);

  // The git root itself is still CHECKED before the walk stops — a brand
  // root is normally its own repo.
  fs.mkdirSync(path.join(outer, 'repo', 'config'), { recursive: true });
  fs.writeFileSync(path.join(outer, 'repo', 'config', 'omega.json5'), `{ brand: { id: 'inner', name: 'Inner' } }`);
  assert.equal(resolveBrandRoot(path.join(outer, 'repo', 'src', 'lib')), path.join(outer, 'repo'));
});

// ─── composeTargetConfig (#31 — the deploy upload boundary) ───

// Brand + local fixture exercising every interleave position, INCLUDING the
// corner a naive whole-file merge gets wrong: `corner` is set by brand
// TARGET and LOCAL SHARED — the local-shared value wins (it merges later), and a
// raw merged targets map would re-apply the brand-target value above it.
const COMPOSE_TREE = {
  'config/omega.json5': `{
    brand: { id: 'acme', name: 'Acme Corp', url: 'https://acme.test' },
    shade: 'brand-shared',
    corner: 'from-brand-shared',
    targets: {
      backend: { type: 'backend', flavor: 'from-brand-target', corner: 'from-brand-target' },
      web: { type: 'web' },
    },
  }`,
  'targets/backend/config/omega.json5': `{
    corner: 'from-local-shared',
    targets: { backend: { type: 'backend', flavor: 'from-local-target' } },
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
  const targetDir = path.join(brandRoot, 'targets', 'backend');

  const { config, files } = composeTargetConfig(path.join(targetDir, 'functions'), 'backend');

  assert.strictEqual(config.brand.name, 'Acme Corp'); // brand layer crossed the boundary
  assert.strictEqual(config.shade, 'brand-shared');
  assert.strictEqual(config.flavor, 'from-local-target'); // local target beats brand target
  assert.strictEqual(config.corner, 'from-local-shared'); // local SHARED beats brand TARGET (the interleave pin)
  assert.deepStrictEqual(config.targets, { backend: { type: 'backend' }, web: { type: 'web' } }); // presence + the declared type
  assert.strictEqual(config.defaultOnly, undefined); // defaults are NOT baked in
  assert.strictEqual(files.brand, path.join(brandRoot, 'config', 'omega.json5'));
});

test('composeTargetConfig: loading the composed file standalone resolves EXACTLY like the local walk-up (the theorem)', (t) => {
  const brandRoot = makeFixture('compose-theorem', COMPOSE_TREE);
  cleanup(t, brandRoot);
  const targetDir = path.join(brandRoot, 'targets', 'backend');

  const { config: composed } = composeTargetConfig(targetDir, 'backend');

  // Simulate the upload boundary: the composed file alone in a fresh root
  const uploadRoot = makeFixture('compose-upload', {
    'config/omega.json5': JSON.stringify(composed, null, 2),
  });
  cleanup(t, uploadRoot);

  const local = loadConfig(targetDir, 'backend', { defaults: COMPOSE_DEFAULTS });
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

test('composeTargetConfig: target dir and its functions/ dir compose identically; no brand layer → self-contained', (t) => {
  const brandRoot = makeFixture('compose-dirs', COMPOSE_TREE);
  cleanup(t, brandRoot);
  const targetDir = path.join(brandRoot, 'targets', 'backend');

  assert.deepStrictEqual(
    composeTargetConfig(targetDir, 'backend').config,
    composeTargetConfig(path.join(targetDir, 'functions'), 'backend').config,
  );

  // ...and its staged dist/ too. Compose is a BUILD-time op over the AUTHORED
  // layers, so a dist/ that already holds a previous compose must normalize up
  // exactly as functions/ does — reading that output back as the local layer
  // would freeze brand edits behind the last stage
  // ([#299](https://github.com/Omega-JS-Stack/omega/issues/299)).
  const distDir = path.join(targetDir, 'dist');
  fs.mkdirSync(path.join(distDir, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(distDir, 'config', 'omega.json5'),
    JSON.stringify({ ...composeTargetConfig(targetDir, 'backend').config, shade: 'stale-stage' }, null, 2),
  );

  assert.deepStrictEqual(
    composeTargetConfig(distDir, 'backend').config,
    composeTargetConfig(targetDir, 'backend').config,
  );
  assert.strictEqual(composeTargetConfig(distDir, 'backend').files.local, path.join(targetDir, 'config', 'omega.json5'));

  const solo = makeFixture('compose-solo', {
    'config/omega.json5': `{ brand: { id: 'solo', name: 'Solo' }, targets: { backend: { type: 'backend', flavor: 'solo-target' } } }`,
  });
  cleanup(t, solo);

  const { config, files } = composeTargetConfig(solo, 'backend');
  assert.strictEqual(files.brand, null);
  assert.strictEqual(config.flavor, 'solo-target');
});

test('composeTargetConfig: local file OPTIONAL inside a brand monorepo — brand-only compose matches loadConfig (src/dist pillar)', (t) => {
  const brandRoot = makeFixture('compose-no-local', {
    'config/omega.json5': COMPOSE_TREE['config/omega.json5'],
    'targets/backend/src/index.js': `// authored tree only: no local omega.json5, no functions/ yet`,
  });
  cleanup(t, brandRoot);
  const targetDir = path.join(brandRoot, 'targets', 'backend');

  const { config, files } = composeTargetConfig(targetDir, 'backend');
  assert.strictEqual(files.local, null); // rides the brand file alone
  assert.strictEqual(config.brand.name, 'Acme Corp');
  assert.strictEqual(config.flavor, 'from-brand-target');
  assert.strictEqual(config.corner, 'from-brand-target'); // no local layers left to beat it
  assert.deepStrictEqual(config.targets, { backend: { type: 'backend' }, web: { type: 'web' } }); // presence + the declared type

  // The theorem holds without a local file: composed-alone ≡ local walk-up,
  // and the target dir + its (future staged) functions/ dir agree.
  const uploadRoot = makeFixture('compose-no-local-upload', {
    'config/omega.json5': JSON.stringify(config, null, 2),
  });
  cleanup(t, uploadRoot);
  const local = loadConfig(targetDir, 'backend', { defaults: COMPOSE_DEFAULTS });
  const viaUpload = loadConfig(uploadRoot, 'backend', { defaults: COMPOSE_DEFAULTS });
  const { targets: localTargets, ...localConfig } = local.config;
  const { targets: uploadTargets, ...uploadConfig } = viaUpload.config;
  assert.deepStrictEqual(uploadConfig, localConfig);
  assert.deepStrictEqual(Object.keys(uploadTargets).sort(), Object.keys(localTargets).sort());
  assert.deepStrictEqual(
    composeTargetConfig(targetDir, 'backend').config,
    composeTargetConfig(path.join(targetDir, 'functions'), 'backend').config,
  );

  // Still a hard error when NOTHING exists (standalone with no file at all)
  const empty = makeFixture('compose-empty', { 'src/index.js': `// nothing` });
  cleanup(t, empty);
  assert.throws(() => composeTargetConfig(empty, 'backend'), /No omega\.json5 found/);
});

test('composeTargetConfig: secrets in either layer hard-fail before any merge', (t) => {
  const brandRoot = makeFixture('compose-secrets', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, apiSecret: 'leaked' }`,
    'targets/backend/config/omega.json5': `{ targets: { backend: { type: 'backend' } } }`,
  });
  cleanup(t, brandRoot);

  assert.throws(
    () => composeTargetConfig(path.join(brandRoot, 'targets', 'backend'), 'backend'),
    /Secret-shaped keys/,
  );
  assert.throws(() => composeTargetConfig(brandRoot, 'nope'), /Unknown target/);
});

test('hasOmegaConfig is brand-aware: a target with NO local-layer file counts when the brand has one', (t) => {
  const brandRoot = makeFixture('probe-brand-aware', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { desktop: { type: 'desktop' } } }`,
    // the target dir exists but carries NO config/omega.json5 (cp121c: optional)
    'targets/desktop/package.json': `{ "name": "acme-desktop" }`,
  });
  cleanup(t, brandRoot);

  const targetDir = path.join(brandRoot, 'targets', 'desktop');
  assert.strictEqual(hasOmegaConfig(targetDir), true, 'the brand file IS the config');
  // and loadConfig agrees — the gate and the loader can never disagree again
  assert.strictEqual(loadConfig(targetDir, 'desktop').config.brand.id, 'acme');

  // a dir with no brand above it stays false (fail-soft in non-consumer dirs)
  assert.strictEqual(hasOmegaConfig(path.join(brandRoot, 'targets')), false);
});

// ─── wave-4 regression (F16): probe and load agree from a functions/ dir ───

test('hasOmegaConfig mirrors loadConfig\'s functions/ → target-root fallback', (t) => {
  const root = makeFixture('probe-functions-fallback', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { backend: { type: 'backend' } } }`,
    'functions/index.js': `// runtime`,
  });
  cleanup(t, root);

  const functionsDir = path.join(root, 'functions');
  // loadConfig succeeds from the functions dir (target-root fallback)…
  assert.strictEqual(loadConfig(functionsDir, 'backend').config.brand.id, 'acme');
  // …so the probe must say true too — a false here made framework gates
  // proceed with an empty config (cp142 class)
  assert.strictEqual(hasOmegaConfig(functionsDir), true);

  // A functions dir with NO config anywhere above stays false
  const bare = makeFixture('probe-functions-bare', { 'functions/index.js': `// runtime` });
  cleanup(t, bare);
  assert.strictEqual(hasOmegaConfig(path.join(bare, 'functions')), false);
});

test('standalone project: an unstaged dist/ resolves the local config exactly as functions/ does', (t) => {
  // `omega test` resolves a backend from its STAGED dist/, but the stage is
  // written by the run — before it exists the dir is empty. The functions/ leg
  // of that fallback was hardcoded, so the same resolution from dist/ threw
  // while functions/ succeeded, and a STANDALONE project (no brand root above
  // to recover through) could not load its own local config
  // ([#299](https://github.com/Omega-JS-Stack/omega/issues/299)).
  const root = makeFixture('probe-dist-fallback', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { backend: { type: 'backend', probe: { value: 'local-target' } } } }`,
    'dist/index.js': `// staged output, no config staged yet`,
    'functions/index.js': `// runtime`,
  });
  cleanup(t, root);

  const distDir = path.join(root, 'dist');
  const functionsDir = path.join(root, 'functions');

  assert.strictEqual(hasOmegaConfig(distDir), true);
  assert.strictEqual(loadConfig(distDir, 'backend').config.brand.id, 'acme');
  assert.deepStrictEqual(
    loadConfig(distDir, 'backend').config,
    loadConfig(functionsDir, 'backend').config,
  );

  // A dist dir with NO config anywhere above stays false, same as functions/
  const bare = makeFixture('probe-dist-bare', { 'dist/index.js': `// staged output` });
  cleanup(t, bare);
  assert.strictEqual(hasOmegaConfig(path.join(bare, 'dist')), false);
});

// ─── The company layer (#54, reshaped by #677) ───

// A PARENT brand carrying a company/ tree, and a brand that names it with one
// typed key: the company file is the layer between framework defaults and the
// brand file, and where the parent lives on this machine is the registry's
// answer, never a stamp.
function makeCompanyFixture(t, name, extra) {
  const workspace = makeFixture(name, Object.assign({
    'parent/config/omega.json5': `{
      brand: { id: 'acme-co', name: 'Acme Inc', url: 'https://acme-co.test' },
      company: { id: 'self' },
    }`,
    'parent/company/config/omega.json5': `{
      monitoring: { providers: { sentry: { org: 'acme-co', dsn: 'https://company.example.com' } } },
      probe: { value: 'company-shared', fromCompanyShared: true },
      targets: { backend: { type: 'backend', probe: { value: 'company-target', fromCompanyTarget: true } } },
    }`,
    'brands/acme/config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      company: { id: 'acme-co' },
      probe: { value: 'brand-shared', fromBrandShared: true },
      targets: { backend: { type: 'backend' }, web: { type: 'web' } },
    }`,
    'brands/acme/targets/backend/package.json': `{ "name": "acme-backend" }`,
  }, extra));

  const parentRoot = path.join(workspace, 'parent');
  const companyRoot = path.join(parentRoot, 'company');
  const brandRoot = path.join(workspace, 'brands', 'acme');

  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = path.join(workspace, 'home');
  t.after(() => {
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  });
  recordBrand({ id: 'acme-co', root: parentRoot, name: 'Acme Inc', url: 'https://acme-co.test' });

  return { workspace, parentRoot, companyRoot, brandRoot };
}

test('company layer: defaults < company shared < company target < brand shared < brand target < local', (t) => {
  const { workspace, companyRoot, brandRoot } = makeCompanyFixture(t, 'company-chain');
  cleanup(t, workspace);

  const defaults = { probe: { value: 'defaults', fromDefaults: true } };
  const { config, files } = loadConfig(path.join(brandRoot, 'targets', 'backend'), 'backend', { defaults });

  // Every layer contributes; the brand still wins over the company
  assert.strictEqual(config.probe.fromDefaults, true);
  assert.strictEqual(config.probe.fromCompanyShared, true);
  assert.strictEqual(config.probe.fromCompanyTarget, true);
  assert.strictEqual(config.probe.value, 'brand-shared');

  // Company-wide values the brand never restates flow all the way down
  assert.strictEqual(config.monitoring.providers.sentry.org, 'acme-co');
  assert.strictEqual(config.monitoring.providers.sentry.dsn, 'https://company.example.com');
  assert.strictEqual(config.brand.id, 'acme');

  // The parent's own facts resolve into the company section (#677), and the
  // brand never restates them
  assert.strictEqual(config.company.name, 'Acme Inc');
  assert.strictEqual(config.company.url, 'https://acme-co.test');

  assert.strictEqual(files.company, path.join(companyRoot, 'config', 'omega.json5'));
});

test('company layer: the brand root reads its own company.id; a brand naming none has no company layer', (t) => {
  const { workspace, brandRoot } = makeCompanyFixture(t, 'company-brand-root');
  cleanup(t, workspace);

  assert.strictEqual(loadConfig(brandRoot).config.monitoring.providers.sentry.org, 'acme-co');

  fs.writeFileSync(
    path.join(brandRoot, 'config', 'omega.json5'),
    `{ brand: { id: 'acme', name: 'Acme' }, targets: { backend: { type: 'backend' } } }`,
  );
  // The company's own values are gone; what remains under `monitoring` is the
  // schema-default layer every config carries (#478), never an inherited fact.
  assert.strictEqual(loadConfig(brandRoot).config.monitoring.providers?.sentry?.org, undefined);
  assert.strictEqual(loadConfig(brandRoot).files.company, null);
  assert.deepStrictEqual(loadConfig(brandRoot).config.company, { id: null, name: 'Acme', url: null, images: {}, webhooks: true });
});

test('company layer: secrets in the company file hard-fail before any merge', (t) => {
  const { workspace, companyRoot, brandRoot } = makeCompanyFixture(t, 'company-secrets');
  cleanup(t, workspace);

  fs.writeFileSync(
    path.join(companyRoot, 'config', 'omega.json5'),
    `{ payment: { stripe: { secret: 'sk_live_x' } } }`,
  );

  assert.throws(() => loadConfig(path.join(brandRoot, 'targets', 'backend'), 'backend'), /Secret-shaped keys/);
});

test('company layer: a standalone project resolves its company from dist/ as well as functions/', (t) => {
  // `omega test` loads a backend's config from its STAGED dist/, and a
  // standalone project has no brand root to resolve through, so the walk
  // normalizing only `functions/` left dist/ asking the build output which
  // company it belongs to and the layer silently vanished
  // ([#257](https://github.com/Omega-JS-Stack/omega/issues/257)).
  const workspace = makeFixture('company-standalone-dist', {
    'parent/config/omega.json5': `{ brand: { id: 'acme-co' }, company: { id: 'self' } }`,
    'parent/company/config/omega.json5': `{ monitoring: { providers: { sentry: { org: 'acme-co' } } } }`,
    'project/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'acme-co' }, targets: { backend: { type: 'backend' } } }`,
    'project/dist/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'acme-co' }, targets: { backend: { type: 'backend' } } }`,
    'project/functions/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'acme-co' }, targets: { backend: { type: 'backend' } } }`,
  });
  cleanup(t, workspace);

  const companyRoot = path.join(workspace, 'parent', 'company');
  const projectRoot = path.join(workspace, 'project');

  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = path.join(workspace, 'home');
  t.after(() => {
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  });
  recordBrand({ id: 'acme-co', root: path.join(workspace, 'parent') });

  const companyFile = path.join(companyRoot, 'config', 'omega.json5');

  // The project root and its functions/ dir already resolved it.
  assert.strictEqual(loadConfig(projectRoot, 'backend').files.company, companyFile);
  assert.strictEqual(loadConfig(path.join(projectRoot, 'functions'), 'backend').files.company, companyFile);

  // ...and the staged dist/ now resolves the same layer.
  const staged = loadConfig(path.join(projectRoot, 'dist'), 'backend');
  assert.strictEqual(staged.files.company, companyFile);
  assert.strictEqual(staged.config.monitoring.providers.sentry.org, 'acme-co');
});

test('company layer: composeTargetConfig freezes it into the upload (the walk-up dies at the deploy boundary)', (t) => {
  const { workspace, brandRoot } = makeCompanyFixture(t, 'company-compose');
  cleanup(t, workspace);

  const targetDir = path.join(brandRoot, 'targets', 'backend');
  const { config } = composeTargetConfig(targetDir, 'backend');

  assert.strictEqual(config.monitoring.providers.sentry.org, 'acme-co');
  assert.strictEqual(config.probe.fromCompanyTarget, true);
  assert.strictEqual(config.probe.value, 'brand-shared');
  assert.deepStrictEqual(Object.keys(config.targets).sort(), ['backend', 'web']);

  // The resolved company facts are frozen in too: a deployed runtime has no
  // registry and no company tree to resolve them from (#677).
  assert.strictEqual(config.company.name, 'Acme Inc');
});

// ─── Environment overlays (#856) ───

// Every layer is TWO files: its omega.json5 and the omega.<environment>.json5
// beside it, the config mirror of the .env / .env.<environment> pair (#586).
// The overlay holds only the overrides, wins over its OWN base, and still
// loses to the layer above.

// Switch the RUNNING environment the way a run states it: through the vars
// envEnvironment() reads. Returns a setter; the originals come back after.
function useEnvironment(t) {
  const keys = ['OMEGA_TEST_MODE', 'ENVIRONMENT', 'FUNCTIONS_EMULATOR', 'TERM_PROGRAM'];
  const saved = keys.map((key) => [key, process.env[key]]);

  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  return (environment) => {
    for (const key of keys) delete process.env[key];
    process.env.ENVIRONMENT = environment;
  };
}

test('#856: an overlay at EVERY layer, each winning over its own base and losing to the next layer', (t) => {
  const { workspace, brandRoot } = makeCompanyFixture(t, 'overlay-chain', {
    'parent/company/config/omega.development.json5': `{
      probe: { value: 'company-overlay-shared', fromCompanyOverlayShared: true },
      order: { companyBase: 'company-overlay', companyVsBrand: 'company-overlay' },
      targets: { backend: { type: 'backend', probe: { value: 'company-overlay-target', fromCompanyOverlayTarget: true } } },
    }`,
    'brands/acme/config/omega.development.json5': `{
      probe: { value: 'brand-overlay', fromBrandOverlay: true },
      order: { brandBase: 'brand-overlay', brandVsLocal: 'brand-overlay' },
    }`,
    'brands/acme/targets/backend/config/omega.json5': `{
      probe: { value: 'local-shared', fromLocalShared: true },
      order: { brandVsLocal: 'local-shared', localBase: 'local-base' },
    }`,
    'brands/acme/targets/backend/config/omega.development.json5': `{
      probe: { value: 'local-overlay', fromLocalOverlay: true },
      order: { localBase: 'local-overlay' },
    }`,
    'brands/acme/targets/backend/config/omega.production.json5': `{
      probe: { fromLocalProduction: true },
    }`,
  });
  cleanup(t, workspace);

  const setEnvironment = useEnvironment(t);
  setEnvironment('development');

  const { config } = loadConfig(path.join(brandRoot, 'targets', 'backend'), 'backend');

  // The strongest layer is the local overlay, and every layer below it still contributed
  assert.strictEqual(config.probe.value, 'local-overlay');
  for (const key of ['fromCompanyShared', 'fromCompanyTarget', 'fromCompanyOverlayShared', 'fromCompanyOverlayTarget', 'fromBrandShared', 'fromBrandOverlay', 'fromLocalShared', 'fromLocalOverlay']) {
    assert.strictEqual(config.probe[key], true, `${key} survived the merge`);
  }

  // Each overlay beats its OWN base...
  assert.strictEqual(config.order.companyBase, 'company-overlay');
  assert.strictEqual(config.order.brandBase, 'brand-overlay');
  assert.strictEqual(config.order.localBase, 'local-overlay');
  // ...and still loses to the next layer's base
  assert.strictEqual(config.order.companyVsBrand, 'company-overlay', 'nothing above restated it');
  assert.strictEqual(config.order.brandVsLocal, 'local-shared', 'the local BASE beats the brand overlay above it');

  // Another environment's overlay is never a layer
  assert.strictEqual(config.probe.fromLocalProduction, undefined);
});

test('#856: an overlay is a PARTIAL - three keys merge, the sibling keys survive, and the MERGED result validates', (t) => {
  const root = makeFixture('overlay-partial', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
      theme: { id: 'classy' },
      payment: { currency: 'USD', providers: { stripe: { publishableKey: 'pk_live_demo' } } },
      analytics: { providers: { google: { id: 'G-LIVE' } } },
      targets: { web: { type: 'web' } },
    }`,
    'config/omega.development.json5': `{
      theme: { id: 'newsflash' },
      payment: { providers: { stripe: { publishableKey: 'pk_test_demo' } } },
      analytics: { providers: { google: { id: 'G-DEV' } } },
    }`,
  });
  cleanup(t, root);

  const setEnvironment = useEnvironment(t);
  setEnvironment('development');

  const { config, errors } = loadConfig(root, 'web');

  assert.deepStrictEqual(errors, [], 'nothing validates an overlay alone; the merged result is what is judged');
  assert.strictEqual(config.theme.id, 'newsflash');
  assert.strictEqual(config.payment.providers.stripe.publishableKey, 'pk_test_demo');
  assert.strictEqual(config.analytics.providers.google.id, 'G-DEV');

  // Everything the three-key overlay never restates comes from the base
  assert.strictEqual(config.brand.name, 'Acme');
  assert.strictEqual(config.brand.url, 'https://acme.test');
  assert.strictEqual(config.payment.currency, 'USD');
});

test('#856: only the RUNNING environment overlays - production never sees the development value, and an unknown name is not a layer at all', (t) => {
  const root = makeFixture('overlay-running-only', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      theme: { id: 'base' },
      targets: { web: { type: 'web' } },
    }`,
    'config/omega.development.json5': `{ theme: { id: 'development' }, probe: { fromDevelopment: true } }`,
    'config/omega.production.json5': `{ theme: { id: 'production' } }`,
    'config/omega.staging.json5': `{ theme: { id: 'staging' }, probe: { fromStaging: true } }`,
  });
  cleanup(t, root);

  const setEnvironment = useEnvironment(t);

  setEnvironment('production');
  const production = loadConfig(root, 'web').config;
  assert.strictEqual(production.theme.id, 'production');
  assert.strictEqual(production.probe, undefined, 'the development overlay is not in a production build');

  setEnvironment('development');
  const development = loadConfig(root, 'web').config;
  assert.strictEqual(development.theme.id, 'development');
  assert.strictEqual(development.probe.fromDevelopment, true);

  // `staging` is not an environment OMEGA has, so that file is not a layer:
  // nothing reads it in either run, and there is nothing to warn about
  assert.strictEqual(production.probe?.fromStaging, undefined);
  assert.strictEqual(development.probe.fromStaging, undefined);
});

test('#856: an overlay is judged by the same raw-file hard fails as the base beside it', (t) => {
  const root = makeFixture('overlay-secrets', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { web: { type: 'web' } } }`,
    'config/omega.development.json5': `{ payment: { providers: { stripe: { secretKey: 'sk_live_x' } } } }`,
  });
  cleanup(t, root);

  const setEnvironment = useEnvironment(t);
  setEnvironment('development');

  assert.throws(
    () => loadConfig(root, 'web'),
    /Secret-shaped keys in .*omega\.development\.json5.*payment\.providers\.stripe\.secretKey/,
  );
});

test('#856: a brand overlay is the BRAND layer, so a named target still derives its own url under it', (t) => {
  const root = makeFixture('overlay-brand-url', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
      targets: { web: { type: 'web' }, admin: { type: 'web' } },
    }`,
    'config/omega.development.json5': `{ brand: { url: 'https://acme.localhost' } }`,
    'targets/web/package.json': '{}',
    'targets/admin/package.json': '{}',
  });
  cleanup(t, root);

  const setEnvironment = useEnvironment(t);
  setEnvironment('development');

  const admin = loadConfig(path.join(root, 'targets', 'admin'), 'web');
  assert.strictEqual(admin.config.brand.url, 'https://acme.localhost');
  assert.strictEqual(admin.config.url, 'https://admin.acme.localhost', 'the overlay is the brand layer, not an override below it');
});

test('#856: the sandbox brand ships a development overlay - the Stripe publishable key is set there and nowhere else', (t) => {
  const brandRoot = path.join(__dirname, '..', '..', '..', 'brands', 'sandbox-brand');
  const setEnvironment = useEnvironment(t);

  setEnvironment('development');
  const development = loadConfig(brandRoot);
  assert.strictEqual(development.config.payment.providers.stripe.publishableKey, 'pk_test_demo-sandbox-brand');

  setEnvironment('production');
  const production = loadConfig(brandRoot);
  assert.strictEqual(production.config.payment.providers.stripe.publishableKey, null, 'production carries the base value');
});

test('#856: options.environment names the overlay, beating this machine ambient answer', (t) => {
  const root = makeFixture('overlay-explicit', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      theme: { id: 'base' },
      targets: { web: { type: 'web' } },
    }`,
    'config/omega.development.json5': `{ theme: { id: 'development' }, probe: { fromDevelopment: true } }`,
    'config/omega.production.json5': `{ theme: { id: 'production' } }`,
  });
  cleanup(t, root);

  const setEnvironment = useEnvironment(t);
  setEnvironment('development');

  // The LANE names the environment its artifact is for: a production build runs
  // on a machine whose ambient answer is `development`, and the artifact still
  // carries production values only.
  const production = loadConfig(root, 'web', { environment: 'production' }).config;
  assert.strictEqual(production.theme.id, 'production');
  assert.strictEqual(production.probe, undefined, 'no development override reaches a production artifact');

  // Unnamed, the ambient answer still decides: a dev boot changes nothing.
  assert.strictEqual(loadConfig(root, 'web').config.theme.id, 'development');
});

test('#856: an unknown options.environment throws naming the three names', (t) => {
  const root = makeFixture('overlay-unknown-environment', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { web: { type: 'web' } } }`,
  });
  cleanup(t, root);

  assert.throws(
    () => loadConfig(root, 'web', { environment: 'staging' }),
    /Unknown environment "staging".*development, testing, production/,
  );
  assert.throws(
    () => composeTargetConfig(root, 'web', { environment: 'staging' }),
    /Unknown environment "staging".*development, testing, production/,
  );
});

test('#856: composeTargetConfig freezes the overlay of the environment it is TOLD, and none when told nothing', (t) => {
  const targetDir = path.join(__dirname, '..', '..', '..', 'brands', 'sandbox-brand', 'targets', 'backend');
  const setEnvironment = useEnvironment(t);

  // The composing machine answers `development`, and it is never asked: an
  // upload composed for production carries the base value.
  setEnvironment('development');
  const production = composeTargetConfig(targetDir, 'backend', { environment: 'production' });
  assert.strictEqual(production.config.payment.providers.stripe.publishableKey, null,
    'the development test key never rides a production upload');

  const development = composeTargetConfig(targetDir, 'backend', { environment: 'development' });
  assert.strictEqual(development.config.payment.providers.stripe.publishableKey, 'pk_test_demo-sandbox-brand',
    'a local stage composes the development overlay the same way its .env does');

  // Told nothing, a compose is the authored layers alone: no overlay at all,
  // whatever this machine happens to answer.
  assert.strictEqual(composeTargetConfig(targetDir, 'backend').config.payment.providers.stripe.publishableKey, null);
});

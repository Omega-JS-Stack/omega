/**
 * Multi-instance targets (plans/multi-instance-targets.md): normalization
 * (object → [{ id: 'main', ...entry }]), the app-dir ↔ instance walk, the
 * validator's array rules (ids required/dir-safe/unique; >1 backend warns),
 * the instance dimension in loadConfig/composeTargetConfig, port offsets,
 * and per-instance URL resolution.
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * loader test convention.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadConfig, composeTargetConfig, validateConfig,
  normalizeTargetInstances, instanceIdFromDirName, instanceAppDir, appInstance,
  resolveInstanceEntry, instancePortOffset, resolveInstanceUrl,
  APP_DIR_TARGETS, TARGET_APP_DIRS, MAIN_INSTANCE,
} = require('../src/index.js');

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

// ─── Normalization (the whole trick) ───

test('normalizeTargetInstances: object → [{ id: main, ...entry }]; array passes through; absent → []', () => {
  assert.deepStrictEqual(normalizeTargetInstances({ theme: { id: 'classy' } }), [{ id: 'main', theme: { id: 'classy' } }]);
  assert.deepStrictEqual(normalizeTargetInstances({}), [{ id: 'main' }]);
  assert.deepStrictEqual(normalizeTargetInstances(undefined), []);
  assert.deepStrictEqual(normalizeTargetInstances(null), []);

  const array = [{ id: 'main' }, { id: 'admin', url: 'https://admin.acme.test' }];
  assert.deepStrictEqual(normalizeTargetInstances(array), array);
  // ...as copies, never the caller's references
  assert.notStrictEqual(normalizeTargetInstances(array)[0], array[0]);

  // An authored id inside the object form wins over the main default
  assert.deepStrictEqual(normalizeTargetInstances({ id: 'primary' }), [{ id: 'primary' }]);
});

// ─── App-dir ↔ instance walk ───

test('instanceIdFromDirName / instanceAppDir: canonical dir = main, <canonical>-<id> = the instance, and they invert', () => {
  assert.strictEqual(instanceIdFromDirName('website', 'web'), 'main');
  assert.strictEqual(instanceIdFromDirName('website-admin', 'web'), 'admin');
  assert.strictEqual(instanceIdFromDirName('website-cdn', 'web'), 'cdn');
  assert.strictEqual(instanceIdFromDirName('backend', 'backend'), 'main');
  // Unconventional dir names behave as today — the primary
  assert.strictEqual(instanceIdFromDirName('api', 'backend'), 'main');

  assert.strictEqual(instanceAppDir('web', 'main'), 'website');
  assert.strictEqual(instanceAppDir('web', 'admin'), 'website-admin');
  assert.strictEqual(instanceAppDir('backend', 'main'), 'backend');

  // The mapping SSOT moved here from the manager — both directions agree
  assert.strictEqual(APP_DIR_TARGETS.website, 'web');
  assert.strictEqual(TARGET_APP_DIRS.web, 'website');
  assert.strictEqual(MAIN_INSTANCE, 'main');
});

test('appInstance: brand apps resolve through the dir walk (functions/ normalizes up); standalone dirs are always main', (t) => {
  const root = makeFixture('inst-appinstance', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { web: [{ id: 'main' }, { id: 'admin' }], backend: {} } }`,
    'apps/website/package.json': '{}',
    'apps/website-admin/package.json': '{}',
    'apps/backend/functions/package.json': '{}',
  });
  cleanup(t, root);

  assert.strictEqual(appInstance(path.join(root, 'apps', 'website'), 'web'), 'main');
  assert.strictEqual(appInstance(path.join(root, 'apps', 'website-admin'), 'web'), 'admin');
  assert.strictEqual(appInstance(path.join(root, 'apps', 'backend', 'functions'), 'backend'), 'main');

  // A STANDALONE project whose dir happens to look suffixed stays main
  const standalone = makeFixture('website-admin', {
    'config/omega.json5': `{ brand: { id: 'solo', name: 'Solo' }, targets: { web: {} } }`,
  });
  cleanup(t, standalone);
  assert.strictEqual(appInstance(standalone, 'web'), 'main');
});

// ─── resolveInstanceEntry (the merge layer) ───

test('resolveInstanceEntry: object form applies to every instance; array form is exact-id with the id stripped', () => {
  const objectForm = { theme: { id: 'classy' } };
  assert.strictEqual(resolveInstanceEntry(objectForm, 'main'), objectForm);
  assert.strictEqual(resolveInstanceEntry(objectForm, 'docs'), objectForm, 'single-object form is today\'s behavior for ANY app of the type');

  const arrayForm = [{ id: 'main', flavor: 'primary' }, { id: 'admin', flavor: 'console' }];
  assert.deepStrictEqual(resolveInstanceEntry(arrayForm, 'admin'), { flavor: 'console' });
  assert.deepStrictEqual(resolveInstanceEntry(arrayForm, 'main'), { flavor: 'primary' });
  // No matching id → no instance layer (shared config alone)
  assert.strictEqual(resolveInstanceEntry(arrayForm, 'cdn'), null);
  assert.strictEqual(resolveInstanceEntry(undefined, 'main'), null);
});

// ─── Validator rules ───

const VALID_BRAND = { brand: { id: 'acme', name: 'Acme' } };

test('validator: array entries MUST carry dir-safe ids, unique per type', () => {
  const missingId = validateConfig({ ...VALID_BRAND, targets: { web: [{ id: 'main' }, { url: 'https://x.test' }] } });
  assert.ok(missingId.errors.some((e) => e.includes('targets.web[1]') && e.includes('dir-safe id')));

  const badId = validateConfig({ ...VALID_BRAND, targets: { web: [{ id: 'Admin Console' }] } });
  assert.ok(badId.errors.some((e) => e.includes('targets.web[0]') && e.includes('dir-safe id')));

  const dupe = validateConfig({ ...VALID_BRAND, targets: { web: [{ id: 'admin' }, { id: 'admin' }] } });
  assert.ok(dupe.errors.some((e) => e.includes('"admin"') && e.includes('not unique')));

  const empty = validateConfig({ ...VALID_BRAND, targets: { web: [] } });
  assert.ok(empty.errors.some((e) => e.includes('targets.web') && e.includes('must not be empty')));

  const good = validateConfig({ ...VALID_BRAND, targets: { web: [{ id: 'main' }, { id: 'admin' }] } });
  assert.deepStrictEqual(good.errors, []);
  assert.deepStrictEqual(good.warnings, []);
});

test('validator: >1 backend instance is a WARNING (unsupported for now), never an error', () => {
  const multi = validateConfig({ ...VALID_BRAND, targets: { backend: [{ id: 'main' }, { id: 'eu' }] } });
  assert.deepStrictEqual(multi.errors, []);
  assert.ok(multi.warnings.some((w) => w.includes('targets.backend') && w.includes('unsupported')));

  // A single-entry backend array is silent
  const single = validateConfig({ ...VALID_BRAND, targets: { backend: [{ id: 'main' }] } });
  assert.deepStrictEqual(single.errors, []);
  assert.deepStrictEqual(single.warnings, []);
});

test('validator: single-object form is untouched — object required, warnings empty (zero breaking change)', () => {
  const ok = validateConfig({ ...VALID_BRAND, targets: { web: {}, backend: { parent: 'self' } } });
  assert.deepStrictEqual(ok.errors, []);
  assert.deepStrictEqual(ok.warnings, []);

  const bad = validateConfig({ ...VALID_BRAND, targets: { web: 'yes' } });
  assert.ok(bad.errors.some((e) => e.includes('targets.web') && e.includes('must be an object')));
});

// ─── The instance dimension in the merge chain ───

// The 2-instance web brand: admin overrides brand-shared keys for ITS
// instance only; main and the shared view stay untouched.
const TWO_INSTANCE_BRAND = {
  'config/omega.json5': `{
    brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
    monitoring: { dsn: 'https://brand-shared.example.com' },
    targets: {
      web: [
        { id: 'main', flavor: 'primary' },
        {
          id: 'admin',
          url: 'https://admin.acme.test',
          flavor: 'console',
          brand: { name: 'Acme Admin' },
          monitoring: { dsn: 'https://admin-override.example.com' },
        },
      ],
      backend: {},
    },
  }`,
  'apps/website/package.json': '{}',
  'apps/website-admin/package.json': '{}',
};

test('loadConfig: the instance entry is the target layer — scoped to ITS app dir only', (t) => {
  const root = makeFixture('inst-compose', TWO_INSTANCE_BRAND);
  cleanup(t, root);

  const main = loadConfig(path.join(root, 'apps', 'website'), 'web');
  assert.deepStrictEqual(main.errors, []);
  assert.strictEqual(main.instance, 'main');
  assert.strictEqual(main.enabled, true);
  assert.strictEqual(main.config.flavor, 'primary');
  assert.strictEqual(main.config.brand.name, 'Acme');
  assert.strictEqual(main.config.monitoring.dsn, 'https://brand-shared.example.com');
  assert.strictEqual(main.config.id, undefined, 'the instance id is bookkeeping, never config');

  const admin = loadConfig(path.join(root, 'apps', 'website-admin'), 'web');
  assert.strictEqual(admin.instance, 'admin');
  assert.strictEqual(admin.config.flavor, 'console');
  assert.strictEqual(admin.config.url, 'https://admin.acme.test', 'instance-level url lands top-level like any target-entry key');
  assert.strictEqual(admin.config.brand.name, 'Acme Admin', 'shared key inside the instance entry overrides brand shared for that instance');
  assert.strictEqual(admin.config.brand.url, 'https://acme.test', 'sibling shared keys survive the merge');
  assert.strictEqual(admin.config.monitoring.dsn, 'https://admin-override.example.com');
  assert.strictEqual(admin.config.id, undefined);
});

test('loadConfig: app shared/target layers still merge ABOVE the instance entry', (t) => {
  const root = makeFixture('inst-app-layer', {
    ...TWO_INSTANCE_BRAND,
    'apps/website-admin/config/omega.json5': `{
      flavor: 'app-shared',
      targets: { web: { flavor: 'app-target' } },
    }`,
  });
  cleanup(t, root);

  const admin = loadConfig(path.join(root, 'apps', 'website-admin'), 'web');
  assert.strictEqual(admin.config.flavor, 'app-target', 'app target beats app shared beats the instance entry');
  assert.strictEqual(admin.config.brand.name, 'Acme Admin', 'instance layer still contributes below the app layers');
});

test('composeTargetConfig: freezes the app dir\'s instance interleave', (t) => {
  const root = makeFixture('inst-stage', TWO_INSTANCE_BRAND);
  cleanup(t, root);

  const main = composeTargetConfig(path.join(root, 'apps', 'website'), 'web');
  const admin = composeTargetConfig(path.join(root, 'apps', 'website-admin'), 'web');

  assert.strictEqual(main.config.flavor, 'primary');
  assert.strictEqual(admin.config.flavor, 'console');
  assert.strictEqual(admin.config.brand.name, 'Acme Admin');
  assert.deepStrictEqual(Object.keys(admin.config.targets).sort(), ['backend', 'web'], 'targets stay presence-only');
});

test('an app dir with no matching instance id rides shared config alone (array form)', (t) => {
  const root = makeFixture('inst-unmatched', {
    ...TWO_INSTANCE_BRAND,
    'apps/website-docs/package.json': '{}',
  });
  cleanup(t, root);

  const docs = loadConfig(path.join(root, 'apps', 'website-docs'), 'web');
  assert.strictEqual(docs.instance, 'docs');
  assert.strictEqual(docs.enabled, true, 'type enablement is key presence, unchanged');
  assert.strictEqual(docs.config.flavor, undefined, 'no instance layer applied');
  assert.strictEqual(docs.config.brand.name, 'Acme');
});

test('single-object brands are byte-identical to before — the instance dimension is invisible (zero breaking change)', (t) => {
  const root = makeFixture('inst-single', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme' },
      targets: { web: { flavor: 'only' } },
    }`,
    'apps/website/package.json': '{}',
    'apps/website-docs/package.json': '{}',
  });
  cleanup(t, root);

  // Object form applies to EVERY web app, suffixed dirs included (today's rule)
  assert.strictEqual(loadConfig(path.join(root, 'apps', 'website'), 'web').config.flavor, 'only');
  assert.strictEqual(loadConfig(path.join(root, 'apps', 'website-docs'), 'web').config.flavor, 'only');
  assert.strictEqual(loadConfig(path.join(root, 'apps', 'website'), 'web').instance, 'main');
});

// ─── Port offsets + instance URLs ───

test('instancePortOffset: position in the normalized array — side-by-side dev ports', () => {
  const entry = [{ id: 'main' }, { id: 'admin' }, { id: 'cdn' }];
  assert.strictEqual(instancePortOffset(entry, 'main'), 0);
  assert.strictEqual(instancePortOffset(entry, 'admin'), 1);
  assert.strictEqual(instancePortOffset(entry, 'cdn'), 2);
  // Object form and unknown ids stay at the classic base
  assert.strictEqual(instancePortOffset({}, 'main'), 0);
  assert.strictEqual(instancePortOffset(entry, 'nope'), 0);
  assert.strictEqual(instancePortOffset(undefined, 'main'), 0);
});

test('resolveInstanceUrl: instance url → instance brand.url → brand shared url', () => {
  const config = { brand: { url: 'https://acme.test' } };
  const entry = [
    { id: 'main' },
    { id: 'admin', url: 'https://admin.acme.test' },
    { id: 'shop', brand: { url: 'https://shop.acme.test' } },
  ];

  assert.strictEqual(resolveInstanceUrl(entry, 'admin', config), 'https://admin.acme.test');
  assert.strictEqual(resolveInstanceUrl(entry, 'shop', config), 'https://shop.acme.test');
  assert.strictEqual(resolveInstanceUrl(entry, 'main', config), 'https://acme.test');
  assert.strictEqual(resolveInstanceUrl({}, 'main', config), 'https://acme.test', 'object form falls to brand.url');
  assert.strictEqual(resolveInstanceUrl(entry, 'main', {}), null);
});

/**
 * Multi-instance targets (_attic/plans/multi-instance-targets.md): normalization
 * (object → [{ id: 'main', ...entry }]), the target-dir ↔ instance walk, the
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
  normalizeTargetInstances, instanceIdFromDirName, instanceTargetDir, targetInstance,
  resolveInstanceEntry, instancePortOffset, resolveInstanceUrl,
  DIR_TARGETS, TARGET_DIRS, MAIN_INSTANCE, toSiteGlobal,
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

// ─── Target-dir ↔ instance walk ───

test('instanceIdFromDirName / instanceTargetDir: canonical dir = main, <canonical>-<id> = the instance, and they invert', () => {
  assert.strictEqual(instanceIdFromDirName('website', 'web'), 'main');
  assert.strictEqual(instanceIdFromDirName('website-admin', 'web'), 'admin');
  assert.strictEqual(instanceIdFromDirName('website-cdn', 'web'), 'cdn');
  assert.strictEqual(instanceIdFromDirName('backend', 'backend'), 'main');
  // Unconventional dir names behave as today — the primary
  assert.strictEqual(instanceIdFromDirName('api', 'backend'), 'main');

  assert.strictEqual(instanceTargetDir('web', 'main'), 'website');
  assert.strictEqual(instanceTargetDir('web', 'admin'), 'website-admin');
  assert.strictEqual(instanceTargetDir('backend', 'main'), 'backend');

  // The mapping SSOT moved here from the manager — both directions agree
  assert.strictEqual(DIR_TARGETS.website, 'web');
  assert.strictEqual(TARGET_DIRS.web, 'website');
  assert.strictEqual(MAIN_INSTANCE, 'main');
});

test('targetInstance: brand targets resolve through the dir walk (functions/ normalizes up); standalone dirs are always main', (t) => {
  const root = makeFixture('inst-appinstance', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { web: [{ id: 'main' }, { id: 'admin' }], backend: {} } }`,
    'targets/website/package.json': '{}',
    'targets/website-admin/package.json': '{}',
    'targets/backend/functions/package.json': '{}',
  });
  cleanup(t, root);

  assert.strictEqual(targetInstance(path.join(root, 'targets', 'website'), 'web'), 'main');
  assert.strictEqual(targetInstance(path.join(root, 'targets', 'website-admin'), 'web'), 'admin');
  assert.strictEqual(targetInstance(path.join(root, 'targets', 'backend', 'functions'), 'backend'), 'main');

  // The staged dist/ normalizes up the same way: reading `dist` as the target dir
  // name resolved every instance to main, so a second instance's staged view
  // silently took the main instance's config
  // ([#299](https://github.com/Omega-JS-Stack/omega/issues/299)).
  assert.strictEqual(targetInstance(path.join(root, 'targets', 'website-admin', 'dist'), 'web'), 'admin');
  assert.strictEqual(targetInstance(path.join(root, 'targets', 'website', 'dist'), 'web'), 'main');

  // A STANDALONE project whose dir happens to look suffixed stays main
  const standalone = makeFixture('website-admin', {
    'config/omega.json5': `{ brand: { id: 'solo', name: 'Solo' }, targets: { web: {} } }`,
  });
  cleanup(t, standalone);
  assert.strictEqual(targetInstance(standalone, 'web'), 'main');
});

// ─── resolveInstanceEntry (the merge layer) ───

test('resolveInstanceEntry: object form applies to every instance; array form is exact-id with the id stripped', () => {
  const objectForm = { theme: { id: 'classy' } };
  assert.strictEqual(resolveInstanceEntry(objectForm, 'main'), objectForm);
  assert.strictEqual(resolveInstanceEntry(objectForm, 'docs'), objectForm, 'single-object form is today\'s behavior for ANY target of the type');

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
    monitoring: { providers: { sentry: { dsn: 'https://brand-shared.example.com' } } },
    targets: {
      web: [
        { id: 'main', flavor: 'primary' },
        {
          id: 'admin',
          url: 'https://admin.acme.test',
          flavor: 'console',
          brand: { name: 'Acme Admin' },
          monitoring: { providers: { sentry: { dsn: 'https://admin-override.example.com' } } },
        },
      ],
      backend: {},
    },
  }`,
  'targets/website/package.json': '{}',
  'targets/website-admin/package.json': '{}',
};

test('loadConfig: the instance entry is the target layer — scoped to ITS target dir only', (t) => {
  const root = makeFixture('inst-compose', TWO_INSTANCE_BRAND);
  cleanup(t, root);

  const main = loadConfig(path.join(root, 'targets', 'website'), 'web');
  assert.deepStrictEqual(main.errors, []);
  assert.strictEqual(main.instance, 'main');
  assert.strictEqual(main.enabled, true);
  assert.strictEqual(main.config.flavor, 'primary');
  assert.strictEqual(main.config.brand.name, 'Acme');
  assert.strictEqual(main.config.monitoring.providers.sentry.dsn, 'https://brand-shared.example.com');
  assert.strictEqual(main.config.id, undefined, 'the instance id is bookkeeping, never config');

  const admin = loadConfig(path.join(root, 'targets', 'website-admin'), 'web');
  assert.strictEqual(admin.instance, 'admin');
  assert.strictEqual(admin.config.flavor, 'console');
  assert.strictEqual(admin.config.url, 'https://admin.acme.test', 'instance-level url lands top-level like any target-entry key');
  assert.strictEqual(admin.config.brand.name, 'Acme Admin', 'shared key inside the instance entry overrides brand shared for that instance');
  assert.strictEqual(admin.config.brand.url, 'https://acme.test', 'sibling shared keys survive the merge');
  assert.strictEqual(admin.config.monitoring.providers.sentry.dsn, 'https://admin-override.example.com');
  assert.strictEqual(admin.config.id, undefined);

  // The TARGET_SUBDIRS views of the same target resolve the same instance — the
  // dist/ leg was missing, so a staged resolution answered `main` and merged
  // the wrong instance's layer
  // ([#299](https://github.com/Omega-JS-Stack/omega/issues/299)).
  for (const subdir of ['functions', 'dist']) {
    const staged = loadConfig(path.join(root, 'targets', 'website-admin', subdir), 'web');
    assert.strictEqual(staged.instance, 'admin', `${subdir}/ resolves its target dir's instance`);
    assert.strictEqual(staged.config.flavor, 'console');
  }
});

test('loadConfig: a bare instance entry resolves its derived url onto the config (#588)', (t) => {
  const root = makeFixture('inst-derived-url', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
      targets: { web: [{ id: 'main' }, { id: 'admin' }, { id: 'store', url: 'https://shop.acme.com' }] },
    }`,
    'targets/website/package.json': '{}',
    'targets/website-admin/package.json': '{}',
    'targets/website-store/package.json': '{}',
  });
  cleanup(t, root);

  // The derived url lands where an explicit instance url already merges to,
  // the top level, so every reader of the resolved config (site-global's
  // site.url, the authDomain host check) sees the instance's OWN url
  const admin = loadConfig(path.join(root, 'targets', 'website-admin'), 'web');
  assert.strictEqual(admin.config.url, 'https://admin.acme.test');
  assert.strictEqual(toSiteGlobal(admin.config).url, 'https://admin.acme.test');

  // An explicit url is untouched, and main keeps the brand url alone
  const store = loadConfig(path.join(root, 'targets', 'website-store'), 'web');
  assert.strictEqual(store.config.url, 'https://shop.acme.com');

  const main = loadConfig(path.join(root, 'targets', 'website'), 'web');
  assert.strictEqual(main.config.url, undefined, 'main derives nothing: brand.url is already its url');
  assert.strictEqual(toSiteGlobal(main.config).url, 'https://acme.test');
});

test('loadConfig: the derived url is the instance url, never the brand-level facts (#588)', (t) => {
  const root = makeFixture('inst-derived-brand-level', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
      cloud: { provider: 'firebase', config: { projectId: 'acme-prod', authDomain: 'acme.test' } },
      targets: { web: [{ id: 'main' }, { id: 'admin' }] },
    }`,
    'targets/website/package.json': '{}',
    'targets/website-admin/package.json': '{}',
  });
  cleanup(t, root);

  const admin = loadConfig(path.join(root, 'targets', 'website-admin'), 'web');
  assert.strictEqual(admin.config.url, 'https://admin.acme.test');

  // authDomain is a BRAND fact (Ian 2026-09-01): one Firebase project, one
  // backend, shared by every instance. The instance url must not turn the
  // brand's own authDomain into a fatal host mismatch.
  assert.deepStrictEqual(admin.errors, []);

  // ... and the derived key is DECLARED, so it raises no undeclared-key
  // warning of its own (#636)
  assert.deepStrictEqual(admin.warnings, []);
});

test('loadConfig: a brand.url override AT the instance IS the instance url, never a base to stack on (#588)', (t) => {
  const root = makeFixture('inst-derived-override', {
    'config/omega.json5': `{
      brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
      targets: { web: [{ id: 'main' }, { id: 'shop' }, { id: 'admin' }] },
    }`,
    'targets/website/package.json': '{}',
    // A local layer naming this instance's own host, never shop.shop.acme.test
    'targets/website-shop/package.json': '{}',
    'targets/website-shop/config/omega.json5': `{
      brand: { url: 'https://shop.acme.test' },
    }`,
    // The dev shape of the same thing, never https://admin.localhost:4000
    'targets/website-admin/package.json': '{}',
    'targets/website-admin/config/omega.json5': `{
      brand: { url: 'http://localhost:4000' },
    }`,
  });
  cleanup(t, root);

  assert.strictEqual(loadConfig(path.join(root, 'targets', 'website-shop'), 'web').config.url, 'https://shop.acme.test');
  assert.strictEqual(loadConfig(path.join(root, 'targets', 'website-admin'), 'web').config.url, 'http://localhost:4000');
});

test('loadConfig: local shared/target layers still merge ABOVE the instance entry', (t) => {
  const root = makeFixture('inst-local-layer', {
    ...TWO_INSTANCE_BRAND,
    'targets/website-admin/config/omega.json5': `{
      flavor: 'local-shared',
      targets: { web: { flavor: 'local-target' } },
    }`,
  });
  cleanup(t, root);

  const admin = loadConfig(path.join(root, 'targets', 'website-admin'), 'web');
  assert.strictEqual(admin.config.flavor, 'local-target', 'local target beats local shared beats the instance entry');
  assert.strictEqual(admin.config.brand.name, 'Acme Admin', 'instance layer still contributes below the local layers');
});

test('composeTargetConfig: freezes the target dir\'s instance interleave', (t) => {
  const root = makeFixture('inst-stage', TWO_INSTANCE_BRAND);
  cleanup(t, root);

  const main = composeTargetConfig(path.join(root, 'targets', 'website'), 'web');
  const admin = composeTargetConfig(path.join(root, 'targets', 'website-admin'), 'web');

  assert.strictEqual(main.config.flavor, 'primary');
  assert.strictEqual(admin.config.flavor, 'console');
  assert.strictEqual(admin.config.brand.name, 'Acme Admin');
  assert.deepStrictEqual(Object.keys(admin.config.targets).sort(), ['backend', 'web'], 'targets stay presence-only');
});

test('a target dir with no matching instance id rides shared config alone (array form)', (t) => {
  const root = makeFixture('inst-unmatched', {
    ...TWO_INSTANCE_BRAND,
    'targets/website-docs/package.json': '{}',
  });
  cleanup(t, root);

  const docs = loadConfig(path.join(root, 'targets', 'website-docs'), 'web');
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
    'targets/website/package.json': '{}',
    'targets/website-docs/package.json': '{}',
  });
  cleanup(t, root);

  // Object form applies to EVERY web target, suffixed dirs included (today's rule)
  assert.strictEqual(loadConfig(path.join(root, 'targets', 'website'), 'web').config.flavor, 'only');
  assert.strictEqual(loadConfig(path.join(root, 'targets', 'website-docs'), 'web').config.flavor, 'only');
  assert.strictEqual(loadConfig(path.join(root, 'targets', 'website'), 'web').instance, 'main');
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

test('resolveInstanceUrl: the instance id IS the subdomain when the entry declares no url (#588)', () => {
  const config = { brand: { url: 'https://acme.test' } };
  const entry = [{ id: 'main' }, { id: 'admin' }, { id: 'cdn' }];

  // A bare id derives its own subdomain, so `web: [{ id: 'main' }, { id: 'admin' }]`
  // is a complete declaration
  assert.strictEqual(resolveInstanceUrl(entry, 'admin', config), 'https://admin.acme.test');
  assert.strictEqual(resolveInstanceUrl(entry, 'cdn', config), 'https://cdn.acme.test');
  // main is the brand itself, never main.acme.test
  assert.strictEqual(resolveInstanceUrl(entry, 'main', config), 'https://acme.test');
  // An id with no entry at all still derives, since the id is the whole input
  assert.strictEqual(resolveInstanceUrl(entry, 'docs', config), 'https://docs.acme.test');
});

test('resolveInstanceUrl: an explicit url beats the derivation, an instance brand.url beats it too', () => {
  const config = { brand: { url: 'https://acme.test' } };
  const entry = [
    { id: 'main' },
    { id: 'store', url: 'https://shop.acme.com' },       // a custom host, not store.acme.test
    { id: 'help', brand: { url: 'https://help.zendesk.com' } },
  ];

  assert.strictEqual(resolveInstanceUrl(entry, 'store', config), 'https://shop.acme.com');
  assert.strictEqual(resolveInstanceUrl(entry, 'help', config), 'https://help.zendesk.com');
});

test('resolveInstanceUrl: the host is taken exactly as brand.url states it (www kept, path dropped, port kept)', () => {
  assert.strictEqual(
    resolveInstanceUrl([{ id: 'admin' }], 'admin', { brand: { url: 'https://www.acme.test' } }),
    'https://admin.www.acme.test',
  );
  assert.strictEqual(
    resolveInstanceUrl([{ id: 'admin' }], 'admin', { brand: { url: 'https://acme.test/base/' } }),
    'https://admin.acme.test',
  );
  assert.strictEqual(
    resolveInstanceUrl([{ id: 'admin' }], 'admin', { brand: { url: 'acme.test:8080' } }),
    'https://admin.acme.test:8080',
  );
});

test('resolveInstanceUrl: no brand url at all → null for a non-main instance too (never half-derived)', () => {
  assert.strictEqual(resolveInstanceUrl([{ id: 'admin' }], 'admin', {}), null);
  assert.strictEqual(resolveInstanceUrl([{ id: 'admin' }], 'admin', undefined), null);
  // An unparseable brand.url derives nothing rather than guessing a host
  assert.strictEqual(resolveInstanceUrl([{ id: 'admin' }], 'admin', { brand: { url: 'https://' } }), null);
});

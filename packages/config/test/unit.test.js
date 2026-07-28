/**
 * Unit tests for @omega.js/config — merge semantics, secret-shaped-key
 * detection, and schema validation (shared + per-target refinements).
 * (File discovery + the full resolution chain are covered by load.test.js.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  deepMerge,
  findSecretKeys,
  SECRET_KEY_PATTERN,
  validateConfig,
  runSchema,
  formatErrors,
  TARGETS,
  SHARED_SECTIONS,
} = require('../src/index.js');

// ─── deepMerge ───

test('objects merge recursively, later layers win', () => {
  const result = deepMerge(
    { brand: { id: 'a', name: 'A' }, theme: { id: 'classy' } },
    { brand: { name: 'B' } },
  );

  assert.deepStrictEqual(result, { brand: { id: 'a', name: 'B' }, theme: { id: 'classy' } });
});

test('arrays replace whole — payment.products never concatenates', () => {
  const result = deepMerge(
    { payment: { products: [{ id: 'basic' }, { id: 'premium' }] } },
    { payment: { products: [{ id: 'ultimate' }] } },
  );

  assert.deepStrictEqual(result.payment.products, [{ id: 'ultimate' }]);
});

test('null replaces, undefined is skipped', () => {
  const result = deepMerge(
    { monitoring: { dsn: 'https://a' }, theme: { id: 'classy' } },
    { monitoring: { dsn: null }, theme: { id: undefined } },
  );

  assert.strictEqual(result.monitoring.dsn, null);
  assert.strictEqual(result.theme.id, 'classy');
});

test('falsy layers are skipped — optional brand file / target section', () => {
  const result = deepMerge(null, { brand: { id: 'a' } }, undefined, { brand: { name: 'A' } });

  assert.deepStrictEqual(result, { brand: { id: 'a', name: 'A' } });
});

test('inputs are never mutated and share no references with the result', () => {
  const base = { brand: { id: 'a' }, payment: { products: [{ id: 'basic' }] } };
  const overlay = { brand: { name: 'A' } };

  const result = deepMerge(base, overlay);
  result.brand.id = 'changed';
  result.payment.products[0].id = 'changed';

  assert.strictEqual(base.brand.id, 'a');
  assert.strictEqual(base.payment.products[0].id, 'basic');
  assert.deepStrictEqual(overlay, { brand: { name: 'A' } });
});

// ─── findSecretKeys ───

test('flags secret-shaped keys at any depth, case-insensitive', () => {
  const found = findSecretKeys({
    stripeSecret: 'x',
    payment: { processors: { stripe: { apiSecret: 'x' } } },
    api: { privateKey: 'x' },
    GOOGLE_ANALYTICS_SECRET: 'x',
  });

  assert.deepStrictEqual(found.sort(), [
    'GOOGLE_ANALYTICS_SECRET',
    'api.privateKey',
    'payment.processors.stripe.apiSecret',
    'stripeSecret',
  ]);
});

test('flags on key NAME even with empty/placeholder values, walks arrays with indices', () => {
  const found = findSecretKeys({
    webhookSecret: '',
    payment: { products: [{ stripe: { productId: 'x' } }, { signingSecret: null }] },
  });

  assert.deepStrictEqual(found.sort(), ['payment.products.1.signingSecret', 'webhookSecret']);
});

test('public credentials pass by design', () => {
  const found = findSecretKeys({
    cloud: { config: { apiKey: 'public-web-key' } },
    payment: { processors: { stripe: { publishableKey: 'pk_test_x' }, paypal: { clientId: 'x' } } },
    oauth2: { google: { clientId: 'x' } },
    brand: { secrets: 'not-a-match-plural' },
  });

  assert.deepStrictEqual(found, []);
  assert.strictEqual(SECRET_KEY_PATTERN.test('publishableKey'), false);
});

// ─── validateConfig: shared schema ───

const VALID = { brand: { id: 'sandbox-brand', name: 'Sandbox Brand' } };

test('minimal valid config passes', () => {
  assert.deepStrictEqual(validateConfig(VALID).errors, []);
});

test('missing required fields are reported', () => {
  const { errors } = validateConfig({ brand: { url: 'https://x.com' } });

  assert.ok(errors.some((e) => e.startsWith('config.brand.id is required')));
  assert.ok(errors.some((e) => e.startsWith('config.brand.name is required')));
});

test('match, enum, and type violations are reported', () => {
  const { errors } = validateConfig({
    brand: { id: 'Not A Slug', name: 'X' },
    theme: { appearance: 'neon' },
    payment: { products: { basic: {} } },
  });

  assert.ok(errors.some((e) => e.includes('config.brand.id') && e.includes('does not match')));
  assert.ok(errors.some((e) => e.includes('config.theme.appearance') && e.includes('must be one of [system, light, dark]')));
  assert.ok(errors.some((e) => e.includes('config.payment.products has wrong type')));
});

test("parent accepts 'self', a URL string, or the deliberate false opt-out — union types (backend rule)", () => {
  const opts = { target: 'backend' };
  assert.deepStrictEqual(validateConfig({ ...VALID, parent: 'self' }, opts).errors, []);
  assert.deepStrictEqual(validateConfig({ ...VALID, parent: 'https://api.example.com' }, opts).errors, []);
  // false = "shared webhook account owned elsewhere" (the playground's shape)
  assert.deepStrictEqual(validateConfig({ ...VALID, parent: false }, opts).errors, []);

  const { errors } = validateConfig({ ...VALID, parent: 42 }, opts);
  assert.ok(errors.some((e) => e.includes('config.parent has wrong type') && e.includes('string|boolean')));
});

test('match/enum only run on present values — null/empty ids are silent', () => {
  const { errors } = validateConfig({
    ...VALID,
    analytics: { providers: { google: { id: null }, meta: { id: null } } },
  });

  assert.deepStrictEqual(errors, []);
});

test('translation section: valid shape passes, provider enum + types enforced', () => {
  assert.deepStrictEqual(
    validateConfig({
      ...VALID,
      translation: { enabled: true, default: 'en', languages: ['es', 'fr'], provider: 'claude', exclude: ['blog'] },
    }).errors,
    [],
  );

  const { errors } = validateConfig({
    ...VALID,
    translation: { languages: 'es', provider: 'gemini' },
  });

  assert.ok(errors.some((e) => e.includes('config.translation.languages has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.translation.provider') && e.includes('must be one of [claude, chatgpt]')));
});

test('devlog + seo are schema-known optional objects (manager-read sections)', () => {
  assert.deepStrictEqual(
    validateConfig({ ...VALID, devlog: { enabled: true, orgs: ['x'] }, seo: { github: { content: [] } } }).errors,
    [],
  );

  const { errors } = validateConfig({ ...VALID, devlog: 'yes', seo: [1] });
  assert.ok(errors.some((e) => e.includes('config.devlog has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.seo has wrong type')));
});

// ─── validateConfig: targets sanity ───

test('unknown target names and non-object entries are errors; {} is enabled-with-defaults', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: { web: {}, extension: {}, website: {}, backend: true },
  });

  assert.ok(errors.some((e) => e.includes('config.targets.website is not a known target')));
  assert.ok(errors.some((e) => e.includes('config.targets.backend must be an object')));
  assert.strictEqual(errors.length, 2);
});

test('all canonical targets are accepted (mobile stays reserved but valid)', () => {
  const targets = Object.fromEntries(TARGETS.map((t) => [t, {}]));

  assert.deepStrictEqual(validateConfig({ ...VALID, targets }).errors, []);
});

// ─── validateConfig: per-target refinements ───

test('target refinements only apply with options.target', () => {
  const config = { ...VALID, startup: { mode: 'invisible' } };

  assert.deepStrictEqual(validateConfig(config).errors, []);

  const { errors } = validateConfig(config, { target: 'desktop' });
  assert.ok(errors.some((e) => e.includes('config.startup.mode') && e.includes('must be one of [normal, hidden]')));
});

test('desktop remoteScripts is a declared key: the opt-in shape passes, wrong types are reported (#21)', () => {
  const armed = { ...VALID, remoteScripts: { enabled: true, url: 'https://acme.example.com/data/scripts/main.js' } };
  assert.deepStrictEqual(validateConfig(armed, { target: 'desktop' }).errors, []);

  const { errors } = validateConfig(
    { ...VALID, remoteScripts: { enabled: 'yes', url: 'ftp://acme.example.com/main.js' } },
    { target: 'desktop' },
  );
  assert.ok(errors.some((e) => e.includes('config.remoteScripts.enabled has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.remoteScripts.url') && e.includes('does not match')));
});

test('unknown options.target throws (programmer error, not a config error)', () => {
  assert.throws(() => validateConfig(VALID, { target: 'website' }), /Unknown target "website"/);
});

// ─── validateConfig: secrets ───

test('secret-shaped keys are validation errors', () => {
  const { errors } = validateConfig({ ...VALID, payment: { processors: { stripe: { apiSecret: 'x' } } } });

  assert.ok(errors.some((e) => e.includes('config.payment.processors.stripe.apiSecret looks like a secret')));
});

// ─── runSchema: conditional required ───

test('required-as-function receives the full config', () => {
  const schema = [{
    path: 'analytics.providers.google.id',
    type: 'string',
    required: (config) => config.analytics && config.analytics.enabled === true,
  }];

  assert.deepStrictEqual(runSchema({ analytics: { enabled: false } }, schema), []);
  assert.strictEqual(runSchema({ analytics: { enabled: true } }, schema).length, 1);
});

// ─── formatErrors / exports ───

test('formatErrors renders a numbered block; empty list renders empty', () => {
  assert.strictEqual(formatErrors([]), '');
  assert.strictEqual(formatErrors(['a', 'b']), '  1. a\n  2. b');
});

test('SHARED_SECTIONS enumerates the disperse-owned sections', () => {
  assert.deepStrictEqual(
    SHARED_SECTIONS,
    ['brand', 'cloud', 'analytics', 'advertising', 'payment', 'monitoring', 'oauth2', 'theme', 'translation'],
  );
});

test('advertising schema: role-keyed providers with the inhouse source (ads spec)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const paths = SHARED_SCHEMA.map((entry) => entry.path);

  assert.ok(paths.includes('advertising.providers.google-adsense.client'));
  assert.ok(paths.includes('advertising.providers.inhouse.source'));
  assert.ok(paths.includes('company.url'));
  for (const slot of ['display-slot', 'in-article-slot', 'in-feed-slot', 'multiplex-slot']) {
    assert.ok(paths.includes(`advertising.providers.google-adsense.${slot}`), `missing ${slot}`);
  }
});

// ─── wave-4 regressions (F12, F15) ───

test('wave-4 secret shapes are flagged: service-account snake_case, secretKey, password, token forms', () => {
  const found = findSecretKeys({
    cloud: { serviceAccount: { private_key: '-----BEGIN-----', private_key_id: 'abc' } },
    payment: { processors: { stripe: { secretKey: 'sk_live_x' } } },
    auth: { password: 'x', accessToken: 'x', refresh_token: 'x' },
    integrations: { github: { token: 'ghp_x' } },
  });

  for (const expected of [
    'cloud.serviceAccount.private_key',
    'cloud.serviceAccount.private_key_id',
    'payment.processors.stripe.secretKey',
    'auth.password',
    'auth.accessToken',
    'auth.refresh_token',
    'integrations.github.token',
  ]) {
    assert.ok(found.includes(expected), `missing ${expected}`);
  }
});

test('wave-4 public shapes still pass: vapidKey, site-key, apiKey', () => {
  const found = findSecretKeys({
    cloud: { messaging: { vapidKey: 'B_public' }, config: { apiKey: 'public' } },
    recaptcha: { 'site-key': 'public' },
  });
  assert.deepStrictEqual(found, []);
});

test('a throwing required() rule surfaces as a named error, never silent-optional', () => {
  const schema = [{
    path: 'brand.name',
    type: 'string',
    required: () => { throw new Error('broken rule'); },
  }];

  const errors = runSchema({}, schema);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /brand\.name required\(\) threw: broken rule/);
});

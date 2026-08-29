/**
 * Unit tests for @omega.js/config's env schema — the ONE inventory of the
 * env keys OMEGA needs (#581): who owns each, which targets read it, whether
 * a default function mints it, whether it is required, and what it does.
 *
 * The manager's three lanes (the generated-key mint, the canonical .env
 * grouping, the disperse composition) and the backend's env reader all derive
 * from this list, so the shape is pinned here and the inventory carries a
 * golden floor: every key those lanes carried before the schema existed must
 * still resolve to an entry.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  ENV_SCHEMA, ENV_GROUPS, TARGETS,
  envSchemaEntry, envKeysForTarget, envKeysByGroup, generatedEnvKeys, requiredEnvKeys,
  devEnvKeys, devEnvKeyMap,
} = require('../src/index.js');

// The union of the three manager lanes as they stood before the schema
// (lib/env-generated.js, lib/env-order.js's groups, disperse's ENV_MAP) — a
// floor, not a ceiling: the schema may grow, never silently shrink.
const MANAGER_LANE_KEYS = [
  'OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY',
  'GH_TOKEN', 'CLOUDFLARE_TOKEN',
  'NAMECHEAP_USERNAME', 'NAMECHEAP_API_KEY',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY',
  'META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN',
  'SENTRY_AUTH_TOKEN',
  'SENDGRID_API_KEY', 'BEEHIIV_API_KEY',
  'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'CHARGEBEE_API_KEY',
  'SLAPFORM_SERVICE_ACCOUNT', 'CHATSY_SERVICE_ACCOUNT', 'REPLYIFY_SERVICE_ACCOUNT', 'SERVER_SERVICE_ACCOUNT', 'MRLOGO_SERVICE_ACCOUNT',
  'APPLE_API_ISSUER', 'APPLE_API_KEY_ID', 'APPLE_TEAM_ID',
  'OMEGA_FONTAWESOME_ROOT',
  'ACCOUNT_PASSWORD_SEED', 'CSC_KEY_PASSWORD', 'VAPID_PRIVATE_KEY',
  'GOOGLE_ANALYTICS_SECRET_WEB', 'GOOGLE_ANALYTICS_SECRET_BACKEND',
  'GOOGLE_ANALYTICS_SECRET_DESKTOP', 'GOOGLE_ANALYTICS_SECRET_EXTENSION',
  'GOOGLE_ANALYTICS_SECRET_MOBILE',
  // #639 retired the OMEGA_-prefixed AI twins outright — a DELIBERATE shrink
  // (one key per provider), so the floor drops them with it
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  // #636 removed COINBASE_API_KEY and APOLLO_API_KEY outright — a dead pair
  // no reader ever existed for, so the floor drops them with the schema
  'NEVERBOUNCE_API_KEY', 'ZEROBOUNCE_API_KEY',
];

// What disperse composed into targets/backend/.env before the schema — the
// derivation must still carry every one of them.
const BACKEND_COMPOSED_FLOOR = [
  'GH_TOKEN',
  'OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'CHARGEBEE_API_KEY',
  'META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN',
  'CLOUDFLARE_TOKEN', 'RECAPTCHA_SECRET_KEY',
  'SENDGRID_API_KEY', 'BEEHIIV_API_KEY', 'NEVERBOUNCE_API_KEY', 'ZEROBOUNCE_API_KEY',
  'UNSUBSCRIBE_HMAC_KEY',
];

test('every entry carries the full rule shape', () => {
  const groupIds = new Set(ENV_GROUPS.map((group) => group.id));

  for (const entry of ENV_SCHEMA) {
    const where = entry.name || String(entry.match);

    assert.ok(entry.name || entry.match instanceof RegExp, `${where}: needs a name or a match pattern`);
    if (entry.name) {
      assert.match(entry.name, /^[A-Z][A-Z0-9_]*$/, `${where}: env names are SCREAMING_SNAKE_CASE`);
    }
    assert.equal(typeof entry.owner, 'string', `${where}: owner service`);
    assert.ok(entry.owner.length > 0, `${where}: owner service is not empty`);
    assert.ok(Array.isArray(entry.targets), `${where}: targets array`);
    for (const target of entry.targets) {
      assert.ok(TARGETS.includes(target), `${where}: ${target} is a known target`);
    }
    assert.ok(groupIds.has(entry.group), `${where}: group "${entry.group}" is declared in ENV_GROUPS`);
    assert.equal(typeof entry.secret, 'boolean', `${where}: secret flag`);
    assert.equal(typeof entry.required, 'boolean', `${where}: required flag`);
    assert.equal(typeof entry.description, 'string', `${where}: description`);
    assert.ok(entry.description.length > 0, `${where}: description is not empty`);

    if ('generated' in entry) {
      assert.equal(typeof entry.generated, 'function', `${where}: generated is the function that mints the value`);
    }
    if ('default' in entry) {
      assert.equal(typeof entry.default, 'string', `${where}: a static default is a string`);
      assert.ok(!('generated' in entry), `${where}: a key is minted or defaulted, never both`);
    }
    // A required key must be one OMEGA can produce — a third-party secret
    // nobody can mint would refuse every boot until it is pasted in
    if (entry.required) {
      assert.ok('generated' in entry || 'default' in entry, `${where}: a required key needs a generator or a default`);
    }
    if ('devOf' in entry) {
      assert.equal(typeof entry.devOf, 'string', `${where}: devOf names the key this one overrides`);
    }
    if ('liveShape' in entry) {
      assert.ok(entry.liveShape instanceof RegExp, `${where}: liveShape is the pattern a LIVE credential matches`);
    }
  }
});

test('names are unique and every group is used', () => {
  const names = ENV_SCHEMA.filter((entry) => entry.name).map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length, 'no key appears twice');

  const used = new Set(ENV_SCHEMA.map((entry) => entry.group));
  const unused = ENV_GROUPS.filter((group) => !used.has(group.id)).map((group) => group.id);
  assert.deepEqual(unused, [], 'every declared group owns at least one key');
});

// #636 — a key with no reader is not an inventory entry, it is a prompt for a
// credential nothing will ever use. COINBASE_API_KEY named a payment provider
// that does not exist (the backend's payment providers are stripe, paypal,
// chargebee and test) and APOLLO_API_KEY named an enrichment lane nobody
// wrote. Both are gone — schema row, `_.env` placeholder, config stub and all.
test('the dead keys are gone — no reader, no entry (#636)', () => {
  for (const name of ['COINBASE_API_KEY', 'APOLLO_API_KEY']) {
    assert.equal(envSchemaEntry(name), undefined, `${name} has no reader anywhere — it must not be declared`);
    assert.ok(!envKeysForTarget('backend').includes(name), `${name} must not compose into targets/backend/.env`);
  }
});

test('every key the manager lanes carried resolves to an entry', () => {
  const missing = MANAGER_LANE_KEYS.filter((name) => !envSchemaEntry(name));
  assert.deepEqual(missing, [], `keys with no schema entry: ${missing.join(', ')}`);
});

test('the backend composition still carries every key disperse composed', () => {
  const composed = envKeysForTarget('backend');
  const missing = BACKEND_COMPOSED_FLOOR.filter((name) => !composed.includes(name));
  assert.deepEqual(missing, [], `keys dropped from the backend composition: ${missing.join(', ')}`);
});

test('generatedEnvKeys(): name → a function that mints a fresh value', () => {
  const generated = generatedEnvKeys();

  assert.deepEqual(Object.keys(generated), ['OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY']);

  for (const [name, mint] of Object.entries(generated)) {
    const value = mint();
    assert.equal(typeof value, 'string', `${name} mints a string`);
    assert.ok(value.length >= 32, `${name} mints key material, not a token`);
    assert.notEqual(mint(), value, `${name} mints a fresh value every call`);
  }
});

test('requiredEnvKeys(): the backend refuses to run without the minted four', () => {
  assert.deepEqual(requiredEnvKeys('backend'), ['OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY']);
  // Nothing else is required — a brand with no Stripe account boots fine
  assert.deepEqual(requiredEnvKeys('web'), []);
});

test('envSchemaEntry(): unknown names miss, dynamic families match their pattern', () => {
  assert.equal(envSchemaEntry('NOT_A_REAL_KEY'), undefined);
  assert.equal(envSchemaEntry('GH_TOKEN').owner, 'repo');

  const oauth2 = envSchemaEntry('OAUTH2_GOOGLE_CLIENT_SECRET');
  assert.ok(oauth2, 'the OAuth2 client family resolves through its pattern');
  assert.equal(oauth2.secret, true);
});

test('the dev-suffixed payment twins are declared, optional, and named after their base key', () => {
  const twins = ENV_SCHEMA.filter((entry) => entry.devOf);

  assert.deepEqual(twins.map((entry) => entry.name), [
    'STRIPE_SECRET_KEY_DEV',
    'PAYPAL_CLIENT_SECRET_DEV',
    'CHARGEBEE_API_KEY_DEV',
  ]);

  for (const entry of twins) {
    assert.equal(entry.name, `${entry.devOf}_DEV`, `${entry.name}: the twin is the base key plus _DEV`);
    assert.ok(envSchemaEntry(entry.devOf), `${entry.name}: ${entry.devOf} is itself a declared key`);
    assert.equal(entry.owner, 'payment', `${entry.name}: owned by the payment service`);
    assert.equal(entry.secret, true, `${entry.name}: a secret`);
    assert.equal(entry.required, false, `${entry.name}: optional — a brand with one payment mode boots fine`);
    assert.ok(!('generated' in entry) && !('default' in entry), `${entry.name}: nobody but the provider can mint it`);
  }
});

test('devEnvKeys()/devEnvKeyMap(): the deploy exclusion set and the base → twin lookup', () => {
  assert.deepEqual(devEnvKeys(), [
    'STRIPE_SECRET_KEY_DEV',
    'PAYPAL_CLIENT_SECRET_DEV',
    'CHARGEBEE_API_KEY_DEV',
  ]);

  const map = devEnvKeyMap();
  assert.equal(map.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY_DEV');
  assert.equal(map.CHARGEBEE_API_KEY, 'CHARGEBEE_API_KEY_DEV');
  assert.equal(map.GH_TOKEN, undefined, 'only payment secrets carry a dev twin');
});

test('the dev twins compose into the backend target .env', () => {
  const composed = envKeysForTarget('backend');

  for (const name of devEnvKeys()) {
    assert.ok(composed.includes(name), `${name} reaches targets/backend/.env — the emulator reads that file`);
  }
  assert.ok(envKeysByGroup().payment.includes('STRIPE_SECRET_KEY_DEV'), 'the twins render beside their base key');
});

test('liveShape: the providers whose credentials announce a LIVE account', () => {
  const stripe = envSchemaEntry('STRIPE_SECRET_KEY').liveShape;
  assert.match('sk_live_abc123', stripe);
  assert.match('rk_live_abc123', stripe, 'restricted live keys charge real cards too');
  assert.doesNotMatch('sk_test_abc123', stripe);

  const chargebee = envSchemaEntry('CHARGEBEE_API_KEY').liveShape;
  assert.match('live_abc123', chargebee);
  assert.doesNotMatch('test_abc123', chargebee);

  // PayPal credentials carry NO live/sandbox marker (both halves are opaque
  // 80-char strings), so PAYPAL_CLIENT_SECRET declares no shape — its split is
  // the _DEV twin alone
  assert.equal('liveShape' in envSchemaEntry('PAYPAL_CLIENT_SECRET'), false);
});

test('envKeysByGroup(): file groups render, runtime keys never reach a brand .env', () => {
  const byGroup = envKeysByGroup();

  assert.deepEqual(byGroup.omega, ['OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY']);

  // The runtime group is the backend's own resolution lanes (config-derived
  // values, disperse's per-target stream secret, the developer's shell) — a
  // brand never hand-writes them, so they are neither rendered nor composed
  const runtime = ENV_GROUPS.find((group) => group.id === 'runtime');
  assert.equal(runtime.file, false);
  assert.ok(byGroup.runtime.includes('GOOGLE_ANALYTICS_SECRET'));
  assert.ok(!envKeysForTarget('backend').includes('GOOGLE_ANALYTICS_SECRET'));
});

test('one AI key per provider — the OMEGA_-prefixed twins are gone', () => {
  // #639: the legacy split (a company-wide OMEGA_* fallback beside the
  // brand's bare key) is retired. The company-wide value lives in the COMPANY
  // layer of the .env cascade under the SAME name, never a second key.
  assert.equal(envSchemaEntry('OMEGA_OPENAI_API_KEY'), undefined);
  assert.equal(envSchemaEntry('OMEGA_ANTHROPIC_API_KEY'), undefined);

  for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
    const entry = envSchemaEntry(name);
    assert.equal(entry.owner, 'backend', `${name} is the backend framework's own key`);
    assert.equal(entry.secret, true);
    assert.equal(entry.required, false, `${name} is optional — nobody mints it`);
    assert.ok(envKeysForTarget('backend').includes(name), `${name} composes into the backend .env`);
  }
});

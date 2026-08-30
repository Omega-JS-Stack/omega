/**
 * Unit tests for @omega.js/config's env presence checker (#626) — the ONE
 * evaluator of `required` and `requiredWhen`, replacing the hand-written
 * if-statements each target used to keep.
 *
 * Presence ONLY, never a value shape (Ian 2026-08-26): a rule fires when the
 * config path is truthy and the key is empty. The checker returns violations;
 * severity is the caller's (build mode and production boot fail, development
 * warns), and it never throws or logs.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { checkEnvRules } = require('../src/index.js');

const FIXTURE = [
  { name: 'MINTED',       owner: 't', targets: ['backend'],  group: 'omega',   secret: true,  required: true,  generated: () => 'x', description: 'A key OMEGA mints for itself.' },
  { name: 'PAIR_SECRET',  owner: 't', targets: ['backend'],  group: 'captcha', secret: true,  required: false, requiredWhen: 'captcha.providers.recaptcha.siteKey', description: 'The secret half of a configured pair.' },
  { name: 'STREAM_WEB',   owner: 't', targets: ['web'],      group: 'machine', secret: true,  required: false, requiredWhen: 'analytics.providers.google.id', deliverAs: 'STREAM_SECRET', description: 'Delivered under its runtime name.' },
  { name: 'UNRULED',      owner: 't', targets: ['backend'],  group: 'payment', secret: true,  required: false, description: 'No rule at all.' },
  { match: /^DYNAMIC_.+$/, owner: 't', targets: ['backend'], group: 'payment', secret: true,  required: false, description: 'A pattern family — no fixed name to check.' },
];

test('required: a missing key is a violation, a present one is not', () => {
  assert.deepEqual(checkEnvRules({}, {}, { schema: FIXTURE }), [
    { key: 'MINTED', rule: 'required', path: null },
  ]);

  assert.deepEqual(checkEnvRules({}, { MINTED: 'value' }, { schema: FIXTURE }), []);
});

test('requiredWhen: the rule fires only when the config path is truthy', () => {
  const configured = { captcha: { providers: { recaptcha: { siteKey: '6Lc-abc' } } } };

  assert.deepEqual(checkEnvRules(configured, { MINTED: 'v' }, { schema: FIXTURE }), [
    { key: 'PAIR_SECRET', rule: 'requiredWhen', path: 'captcha.providers.recaptcha.siteKey' },
  ]);

  // The provider is not configured — nobody owes a secret
  assert.deepEqual(checkEnvRules({ captcha: { providers: { recaptcha: {} } } }, { MINTED: 'v' }, { schema: FIXTURE }), []);
  assert.deepEqual(checkEnvRules({}, { MINTED: 'v' }, { schema: FIXTURE }), []);
  // An empty string is not a configured value
  assert.deepEqual(checkEnvRules({ captcha: { providers: { recaptcha: { siteKey: '' } } } }, { MINTED: 'v' }, { schema: FIXTURE }), []);

  // Configured AND supplied
  assert.deepEqual(checkEnvRules(configured, { MINTED: 'v', PAIR_SECRET: 'shh' }, { schema: FIXTURE }), []);
});

test('an EMPTY value is an absent value — presence, never shape', () => {
  const configured = { captcha: { providers: { recaptcha: { siteKey: '6Lc-abc' } } } };

  assert.deepEqual(checkEnvRules(configured, { MINTED: 'v', PAIR_SECRET: '' }, { schema: FIXTURE }), [
    { key: 'PAIR_SECRET', rule: 'requiredWhen', path: 'captcha.providers.recaptcha.siteKey' },
  ]);

  // …and nothing about the VALUE is ever judged
  assert.deepEqual(checkEnvRules(configured, { MINTED: 'v', PAIR_SECRET: 'not-a-recaptcha-secret' }, { schema: FIXTURE }), []);
});

test('deliverAs: the delivered name satisfies its source key', () => {
  const analytics = { analytics: { providers: { google: { id: 'G-ABC123' } } } };

  // A target's own build sees STREAM_SECRET, never STREAM_WEB
  assert.deepEqual(checkEnvRules(analytics, { MINTED: 'v', STREAM_SECRET: 'shh' }, { schema: FIXTURE, target: 'web' }), []);

  // Missing under either name — the violation names the key a human sets
  assert.deepEqual(checkEnvRules(analytics, {}, { schema: FIXTURE, target: 'web' }), [
    { key: 'STREAM_WEB', rule: 'requiredWhen', path: 'analytics.providers.google.id' },
  ]);
});

test('target: only the entries that name it are evaluated', () => {
  const analytics = { analytics: { providers: { google: { id: 'G-ABC123' } } } };

  // The web target owes the stream secret; the backend's required key is not its business
  assert.deepEqual(checkEnvRules(analytics, {}, { schema: FIXTURE, target: 'web' }).map((v) => v.key), ['STREAM_WEB']);
  assert.deepEqual(checkEnvRules(analytics, {}, { schema: FIXTURE, target: 'backend' }).map((v) => v.key), ['MINTED']);
  // No target = every entry
  assert.deepEqual(checkEnvRules(analytics, {}, { schema: FIXTURE }).map((v) => v.key), ['MINTED', 'STREAM_WEB']);
});

test('the checker never throws — a missing config, a missing env, a pattern family', () => {
  assert.deepEqual(checkEnvRules(undefined, undefined, { schema: FIXTURE }).map((v) => v.key), ['MINTED']);
  assert.deepEqual(checkEnvRules(null, null, { schema: FIXTURE }).map((v) => v.key), ['MINTED']);
  assert.deepEqual(checkEnvRules({}, { MINTED: 'v', DYNAMIC_ANYTHING: '' }, { schema: FIXTURE }), [],
    'a pattern family has no fixed name, so it carries no presence rule');
});

// ─── The real rules (#626) ───

test('the GA Measurement Protocol secret is owed once its stream id is configured', () => {
  const config = { analytics: { providers: { google: { id: 'G-ABC123' } } } };

  for (const [target, key] of [['web', 'GOOGLE_ANALYTICS_SECRET_WEB'], ['backend', 'GOOGLE_ANALYTICS_SECRET_BACKEND'], ['desktop', 'GOOGLE_ANALYTICS_SECRET_DESKTOP'], ['extension', 'GOOGLE_ANALYTICS_SECRET_EXTENSION']]) {
    assert.deepEqual(checkEnvRules(config, {}, { target }).filter((v) => v.rule === 'requiredWhen'), [
      { key, rule: 'requiredWhen', path: 'analytics.providers.google.id' },
    ], `${target}: an id with no secret ships an extension/site that sends no events, silently (#582)`);

    // The delivered name is what a build actually holds
    assert.deepEqual(checkEnvRules(config, { GOOGLE_ANALYTICS_SECRET: 'shh' }, { target }).filter((v) => v.rule === 'requiredWhen'), []);
  }

  // No GA4 id — no secret owed anywhere
  assert.deepEqual(checkEnvRules({}, {}, { target: 'extension' }), []);
});

test('the reCAPTCHA pair, the Sentry token and the Snap credentials', () => {
  assert.deepEqual(checkEnvRules({ captcha: { providers: { recaptcha: { siteKey: '6Lc-abc' } } } }, {}, { target: 'backend' }).filter((v) => v.rule === 'requiredWhen'), [
    { key: 'RECAPTCHA_SECRET_KEY', rule: 'requiredWhen', path: 'captcha.providers.recaptcha.siteKey' },
  ]);

  // Sentry's token belongs to the monitoring SERVICE (no target reads it)
  assert.deepEqual(checkEnvRules({ monitoring: { providers: { sentry: { dsn: 'https://abc@o1.ingest.sentry.io/2' } } } }, {}).filter((v) => v.rule === 'requiredWhen'), [
    { key: 'SENTRY_AUTH_TOKEN', rule: 'requiredWhen', path: 'monitoring.providers.sentry.dsn' },
  ]);

  assert.deepEqual(checkEnvRules({ platforms: { linux: { snap: { enabled: true } } } }, {}, { target: 'desktop' }).filter((v) => v.rule === 'requiredWhen'), [
    { key: 'SNAPCRAFT_STORE_CREDENTIALS', rule: 'requiredWhen', path: 'platforms.linux.snap.enabled' },
  ]);
  assert.deepEqual(checkEnvRules({ platforms: { linux: { snap: { enabled: false } } } }, {}, { target: 'desktop' }).filter((v) => v.rule === 'requiredWhen'), [],
    'snap off = no credentials owed');
});

test('the minted four are the only unconditional requirement', () => {
  const violations = checkEnvRules({}, {}, { target: 'backend' });

  assert.deepEqual(violations.map((v) => v.key), [
    'OMEGA_ADMIN_KEY',
    'OMEGA_WEBHOOK_KEY',
    'OMEGA_NAMESPACE',
    'UNSUBSCRIBE_HMAC_KEY',
  ]);
  for (const violation of violations) assert.equal(violation.rule, 'required');

  // A brand with no Stripe account, no GA4 id and no captcha still boots
  assert.deepEqual(checkEnvRules({}, {
    OMEGA_ADMIN_KEY: 'a', OMEGA_WEBHOOK_KEY: 'b', OMEGA_NAMESPACE: 'c', UNSUBSCRIBE_HMAC_KEY: 'd',
  }, { target: 'backend' }), []);
});

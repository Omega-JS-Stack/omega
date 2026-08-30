// The workspace env-rules op (#626) — the manage-time half of the schema's
// presence rules. A brand's config can make an env key mandatory (a GA4
// Measurement ID needs its Measurement Protocol secret; a reCAPTCHA site key
// needs its secret half), and every target used to discover that on its own,
// late: the extension's build threw, the backend 403'd every protected POST,
// the captcha service paired the halves by hand. The schema declares each rule
// once and this op says it at MANAGE time, naming the key and the config path
// that requires it.
//
// PER ENABLED TARGET (#627 review, C1): the rule-bearing values live where the
// services write them — the analytics service writes a GA4 stream id to
// targets.<t>.analytics.providers.google.id and leaves the shared slot null —
// so a brand-ROOT evaluation saw nothing for the canonical brand shape and
// over-fired (every per-target secret at once) for the shared-id one. Each
// enabled target is evaluated against its own resolved config; entries no
// enabled target claims are never evaluated at all.
//
// It WARNS, never fails: a half-configured brand is a normal step on the way to
// a configured one, and a manage run that refuses to reconcile a brand over a
// key nobody has pasted yet is a hostage note.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const envRulesOp = require('../src/services/workspace/ensure/env-rules.js');
const { loadBrand } = require('../src/lib/brand.js');
const { OPERATIONS } = require('../src/config.js');

// A real brand root on disk — the op resolves each enabled target's config
// through @omega.js/config, so the brand's FILE is the honest input.
function writeBrand(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-env-rules-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), JSON.stringify(config, null, 2));
  return root;
}

// Run the op against a brand fixture with the named keys forced absent/present,
// capturing the lines it prints and restoring the process env afterwards.
async function runOp(config, { env = {} } = {}) {
  const brandRoot = writeBrand(config);
  const saved = {};
  for (const [name, value] of Object.entries(env)) {
    saved[name] = process.env[name];
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  }

  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));

  try {
    const brand = loadBrand(brandRoot);
    const result = await envRulesOp({ brandRoot: brand.root, brandConfig: brand.config, options: {} });
    return { result, lines, keys: result.output.envRules.violations.map((violation) => violation.key) };
  } finally {
    console.log = originalLog;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
}

// The CANONICAL brand shape (brands/omega-playground): the GA4 stream id is
// PER TARGET and the shared slot is null — one stream per surface is what the
// analytics service provisions.
const CANONICAL = {
  brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
  captcha: { providers: { recaptcha: { siteKey: '6Lfixture' } } },
  analytics: { providers: { google: { id: null } } },
  targets: {
    web: { analytics: { providers: { google: { id: 'G-FIXTUREWEB' } } } },
    backend: { analytics: { providers: { google: { id: 'G-FIXTUREBE' } } } },
  },
};

const GA_KEYS = {
  GOOGLE_ANALYTICS_SECRET_WEB: null,
  GOOGLE_ANALYTICS_SECRET_BACKEND: null,
  GOOGLE_ANALYTICS_SECRET_DESKTOP: null,
  GOOGLE_ANALYTICS_SECRET_EXTENSION: null,
  GOOGLE_ANALYTICS_SECRET: null,
};

test('env-rules op: the canonical per-target GA id owes its target\'s secret', async () => {
  const { lines, keys } = await runOp(CANONICAL, {
    env: { RECAPTCHA_SECRET_KEY: null, ...GA_KEYS },
  });

  // The flagship rule, on the shape brands actually carry: the id lives at
  // targets.<t>.analytics.providers.google.id, so a brand-ROOT evaluation
  // (what this op did before #627's review) found nothing to warn about.
  assert.deepEqual(keys.sort(), [
    'GOOGLE_ANALYTICS_SECRET_BACKEND',
    'GOOGLE_ANALYTICS_SECRET_WEB',
    'RECAPTCHA_SECRET_KEY',
  ]);

  const said = lines.join('\n');
  // The BRAND-level key name — what a human sets in the brand .env — and the
  // path that requires it.
  assert.match(said, /GOOGLE_ANALYTICS_SECRET_WEB/);
  assert.match(said, /analytics\.providers\.google\.id/);
  assert.match(said, /RECAPTCHA_SECRET_KEY/);
  assert.match(said, /captcha\.providers\.recaptcha\.siteKey/);
});

test('env-rules op: a target the brand does not enable owes nothing', async () => {
  // The SHARED-id shape: one id for every surface. Only the enabled targets'
  // secrets are owed — the desktop/extension halves of a web+backend brand are
  // keys nobody could ever fill in for a target that does not exist.
  const { keys } = await runOp({
    ...CANONICAL,
    analytics: { providers: { google: { id: 'G-SHARED' } } },
    targets: { web: {}, backend: {} },
  }, { env: { RECAPTCHA_SECRET_KEY: 'fixture-secret', ...GA_KEYS } });

  assert.deepEqual(keys.sort(), ['GOOGLE_ANALYTICS_SECRET_BACKEND', 'GOOGLE_ANALYTICS_SECRET_WEB']);
});

test('env-rules op: each target\'s own secret is judged on its own', async () => {
  const { keys } = await runOp(CANONICAL, {
    env: { RECAPTCHA_SECRET_KEY: 'fixture-secret', ...GA_KEYS, GOOGLE_ANALYTICS_SECRET_WEB: 'web-secret' },
  });

  assert.deepEqual(keys, ['GOOGLE_ANALYTICS_SECRET_BACKEND']);
});

test('env-rules op: a target-less entry is judged against the brand config', async () => {
  // SENTRY_AUTH_TOKEN belongs to the monitoring SERVICE — no target reads it,
  // so no target's resolved config could ever raise it.
  const { keys } = await runOp({
    brand: { id: 'fixture' },
    monitoring: { providers: { sentry: { dsn: 'https://abc@o1.ingest.sentry.io/2' } } },
    targets: { web: {} },
  }, { env: { SENTRY_AUTH_TOKEN: null, ...GA_KEYS } });

  assert.deepEqual(keys, ['SENTRY_AUTH_TOKEN']);
});

test('env-rules op: a key the cascade already serves is not a violation', async () => {
  const { result } = await runOp(
    { brand: { id: 'fixture' }, captcha: { providers: { recaptcha: { siteKey: '6Lfixture' } } }, targets: { backend: {} } },
    { env: { RECAPTCHA_SECRET_KEY: 'fixture-secret' } },
  );

  assert.deepEqual(result.output.envRules.violations, []);
});

test('env-rules op: an unconfigured brand owes nothing — the rule is one-directional', async () => {
  const { result, lines } = await runOp({ brand: { id: 'fixture' }, targets: { web: {}, backend: {} } }, {
    env: { RECAPTCHA_SECRET_KEY: null, ...GA_KEYS },
  });

  assert.deepEqual(result.output.envRules.violations, []);
  assert.match(lines.join('\n'), /✓/, 'the clean state still says so');
});

test('env-rules: the op runs in the workspace service', () => {
  assert.ok(
    OPERATIONS.workspace.some((operation) => operation.name === 'env-rules'),
    'the workspace service walks it',
  );
});

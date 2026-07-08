/**
 * reCAPTCHA service tests — shared-key validation against a recording fake
 * of the siteverify endpoint. Proves skip semantics, the valid-secret probe
 * (exactly one read, never a mutation — the service has none), the
 * invalid-secret failure, the de-ITW'd console URL, and dry-run parity.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/recaptcha/index.js');

// Tests must never see real credentials from the shell environment; non-skip
// tests set fixture values explicitly (the site key is handler data)
delete process.env.RECAPTCHA_SITE_KEY;
delete process.env.RECAPTCHA_SECRET_KEY;

const DOMAIN = 'fixture-brand.test';
const SITE_KEY = '6LfixtureFixtureFixtureFixture';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ url = `https://${DOMAIN}` } = {}) {
  return {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url },
    recaptcha: structuredClone(DEFAULTS.recaptcha),
    targets: { web: {} },
  };
}

/** Recording fake RecaptchaAPI — siteverify answers with the given error codes. */
function fakeRecaptcha({ errorCodes = ['invalid-input-response'] } = {}) {
  const api = { calls: [] };

  api.verify = async (response) => {
    api.calls.push({ method: 'verify', response });
    return { success: false, 'error-codes': [...errorCodes] };
  };

  return api;
}

function runService(config, { recaptcha, options = {}, env = true } = {}) {
  if (env) {
    process.env.RECAPTCHA_SITE_KEY = SITE_KEY;
    process.env.RECAPTCHA_SECRET_KEY = 'fixture-secret-key';
  } else {
    delete process.env.RECAPTCHA_SITE_KEY;
    delete process.env.RECAPTCHA_SECRET_KEY;
  }

  return service.run({
    brandId: 'fixture-brand',
    brandRoot: '/tmp/omega-manager-recaptcha-unused', // no handler touches disk
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.recaptcha,
    options,
    serviceData: {},
    recaptchaApi: recaptcha,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('recaptcha: skips without the shared keys in .env', async () => {
  const result = await runService(brandConfig(), { env: false });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /RECAPTCHA_SITE_KEY \+ RECAPTCHA_SECRET_KEY/);
});

test('recaptcha: skip reason names only the missing key', async () => {
  process.env.RECAPTCHA_SITE_KEY = SITE_KEY;
  delete process.env.RECAPTCHA_SECRET_KEY;

  const result = await service.run({
    brandId: 'fixture-brand',
    brandRoot: '/tmp/omega-manager-recaptcha-unused',
    brandConfig: brandConfig(),
    brandState: {},
    apps: [],
    operations: OPERATIONS.recaptcha,
    options: {},
    serviceData: {},
  });

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no RECAPTCHA_SECRET_KEY configured/);
  assert.doesNotMatch(result.reason, /RECAPTCHA_SITE_KEY/);
});

test('recaptcha: recaptcha.enabled = false skips the service', async () => {
  const config = brandConfig();
  config.recaptcha.enabled = false;

  const result = await runService(config, { recaptcha: fakeRecaptcha() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /recaptcha\.enabled/);
});

test('recaptcha: skips without brand.url', async () => {
  const result = await runService(brandConfig({ url: '' }), { recaptcha: fakeRecaptcha() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /brand\.url/);
});

// ─── Secret validation ───────────────────────────────────────────────────────

test('recaptcha: valid secret is a success with exactly one read probe', async () => {
  const api = fakeRecaptcha(); // invalid-input-response = the probe token was rejected, the secret was not

  const result = await runService(brandConfig(), { recaptcha: api });

  assert.equal(result.status, 'success');
  assert.equal(result.output.siteKey.secretValid, true);
  assert.deepEqual(result.output.siteKey.domains, [DOMAIN, `www.${DOMAIN}`]);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].method, 'verify');
});

test('recaptcha: invalid secret fails the service with .env guidance', async () => {
  const api = fakeRecaptcha({ errorCodes: ['invalid-input-secret'] });

  const result = await runService(brandConfig(), { recaptcha: api });

  assert.equal(result.status, 'error');
  assert.match(result.error, /RECAPTCHA_SECRET_KEY is invalid/);
});

// ─── Console URL (de-ITW'd) ──────────────────────────────────────────────────

test('recaptcha: no project configured → generic classic admin console URL', async () => {
  const result = await runService(brandConfig(), { recaptcha: fakeRecaptcha() });

  // omega-manager hardcoded ?project=itw-creative-works — the default must
  // carry no company value at all
  assert.equal(result.output.siteKey.consoleUrl, 'https://www.google.com/recaptcha/admin');
});

test('recaptcha: recaptcha.project deep-links the cloud console key page', async () => {
  const config = brandConfig();
  config.recaptcha.project = 'my-shared-project';

  const result = await runService(config, { recaptcha: fakeRecaptcha() });

  assert.equal(
    result.output.siteKey.consoleUrl,
    `https://console.cloud.google.com/security/recaptcha/${SITE_KEY}/overview?project=my-shared-project`,
  );
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('recaptcha: dry-run behaves identically — the probe is a pure read', async () => {
  const api = fakeRecaptcha();

  const result = await runService(brandConfig(), { recaptcha: api, options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.equal(result.output.siteKey.secretValid, true);
  assert.equal(api.calls.length, 1);
});

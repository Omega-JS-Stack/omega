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

function runService(config, { recaptcha, options = {}, env = true, serviceData = {} } = {}) {
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
    serviceData,
    recaptchaApi: recaptcha,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('recaptcha: skips without the shared keys in .env', async () => {
  const result = await runService(brandConfig(), { env: false });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /RECAPTCHA_SITE_KEY, RECAPTCHA_SECRET_KEY/);
  // cp114: the skip is machine-readable — the 🔑 summary aggregates it
  assert.deepEqual(result.missingEnv, ['RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY']);
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
  assert.match(result.reason, /missing RECAPTCHA_SECRET_KEY/);
  assert.doesNotMatch(result.reason, /RECAPTCHA_SITE_KEY/);
  assert.deepEqual(result.missingEnv, ['RECAPTCHA_SECRET_KEY']);
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

// ─── Interactive add-domain confirm (manual-only poll + state stamp) ─────────

const { setBrowserOpener } = require('@omega.js/devkit/flows');
const { openTtyPrompt } = require('./lib/interactive.js');

test('site-key: interactive run opens the console and stamps the confirmed domain list', async () => {
  const api = fakeRecaptcha(); // invalid-input-response = valid secret
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig(), { recaptcha: api });
    await tty.answer('Press Enter to open the reCAPTCHA console', '\r');
    // ENTER = "domains saved" — nudge until the manual-only poll picks it up
    await tty.answer('(enter)=done', '\r');
    const nudge = setInterval(() => { tty.answer('(enter)=done', '\r').catch(() => {}); }, 80);
    let result;
    try {
      result = await run;
    } finally {
      clearInterval(nudge);
    }

    assert.equal(result.status, 'success');
    assert.deepEqual(result.state.domainsConfirmed, [DOMAIN, `www.${DOMAIN}`]);
    assert.deepEqual(opened, ['https://www.google.com/recaptcha/admin']);
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

// ─── De-ITW pins (cp257): the ask is the ONLY path to a key ──────────────────

const fs = require('node:fs');
const path = require('node:path');
const { REQUIRES } = require('../src/config.js');

test("requires: RECAPTCHA_* walkthrough mints at the GCP reCAPTCHA console (the brand's own project)", () => {
  const env = REQUIRES.recaptcha.env;
  assert.deepEqual(env.map((e) => e.name), ['RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY']);
  for (const entry of env) {
    assert.equal(entry.url, 'https://console.cloud.google.com/security/recaptcha');
    assert.equal(entry.prompted, true);
  }
});

test('requires/defaults: no ITW or hardcoded key value anywhere in the recaptcha registry', () => {
  // The paste flow must be the only path to a key — no default value exists
  assert.equal(DEFAULTS.recaptcha.project, null);
  const serialized = JSON.stringify({ defaults: DEFAULTS.recaptcha, requires: { why: REQUIRES.recaptcha.why, env: REQUIRES.recaptcha.env } });
  assert.doesNotMatch(serialized, /itw/i);
  assert.doesNotMatch(serialized, /6L[0-9A-Za-z_-]{38}/); // a real site-key literal
});

test('recaptcha service source carries no hardcoded key or company value', () => {
  const serviceDir = path.join(__dirname, '../src/services/recaptcha');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(serviceDir);

  assert.ok(files.length >= 3); // index + ensure + lib
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /6L[0-9A-Za-z_-]{38}/, `${file} carries a site-key literal`);
    assert.doesNotMatch(source, /itw-creative-works/i, `${file} carries the company project`);
  }
});

test('site-key: a stamped domain list never re-prompts, even interactively', async () => {
  const api = fakeRecaptcha();
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt(); // interactive — without the stamp the flow WOULD prompt

  try {
    const result = await runService(brandConfig(), {
      recaptcha: api,
      serviceData: { domainsConfirmed: [DOMAIN, `www.${DOMAIN}`] },
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(opened, []); // no browser, no prompt — the run resolved unattended
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

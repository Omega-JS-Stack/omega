/**
 * Captcha service tests — shared-key validation against a recording fake
 * of the siteverify endpoint. Proves skip semantics, the valid-secret probe
 * (exactly one read, never a mutation — the service has none), the
 * invalid-secret failure, the de-ITW'd console URL, and dry-run parity.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/captcha/index.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');

// Tests must never see real credentials from the shell environment; non-skip
// tests set fixture values explicitly (the site key is handler data)
delete process.env.RECAPTCHA_SITE_KEY;
delete process.env.RECAPTCHA_SECRET_KEY;

const DOMAIN = 'fixture-brand.test';
const SITE_KEY = '6LfixtureFixtureFixtureFixture';

// ─── Fixtures ────────────────────────────────────────────────────────────────

// A fully-keyed brand by default: the public half in config (what the client
// renders), the secret half in the .env runService sets. `siteKey: null` is
// the unkeyed brand — the sanctioned green state (#17, #507).
function brandConfig({ url = `https://${DOMAIN}`, siteKey = SITE_KEY } = {}) {
  const recaptcha = structuredClone(DEFAULTS.captcha.providers.recaptcha);
  if (siteKey) recaptcha.siteKey = siteKey;

  return {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url },
    captcha: { providers: { recaptcha } },
    targets: { web: {} },
  };
}

// The domain confirm writes into omega.json5 (#434), so confirm-path runs get
// a real brand root; a stamped fixture carries the confirmed list on disk too
function fixtureConfigSource({ domainsConfirmed } = {}) {
  const stamp = domainsConfirmed ? `, domainsConfirmed: ${JSON.stringify(domainsConfirmed)}` : '';
  return `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://${DOMAIN}' },
  captcha: { providers: { recaptcha: { enabled: true${stamp} } } },
}
`;
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

function runService(config, { recaptcha, options = {}, env = true, brandRoot } = {}) {
  if (env) {
    process.env.RECAPTCHA_SITE_KEY = SITE_KEY;
    process.env.RECAPTCHA_SECRET_KEY = 'fixture-secret-key';
  } else {
    delete process.env.RECAPTCHA_SITE_KEY;
    delete process.env.RECAPTCHA_SECRET_KEY;
  }

  return service.run({
    brandId: 'fixture-brand',
    // Only the confirm path writes to disk; other tests never touch the root
    brandRoot: brandRoot || '/tmp/omega-manager-recaptcha-unused',
    brandConfig: config,
    brand: { id: 'fixture-brand', config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.captcha,
    options,
    serviceData: {},
    recaptchaApi: recaptcha,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('captcha: skips without the shared keys in .env', async () => {
  const result = await runService(brandConfig({ siteKey: null }), { env: false });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /RECAPTCHA_SITE_KEY, RECAPTCHA_SECRET_KEY/);
  // cp114: the skip is machine-readable — the 🔑 summary aggregates it
  assert.deepEqual(result.missingEnv, ['RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY']);
});

test('captcha: skip reason names only the missing key', async () => {
  process.env.RECAPTCHA_SITE_KEY = SITE_KEY;
  delete process.env.RECAPTCHA_SECRET_KEY;

  const result = await service.run({
    brandId: 'fixture-brand',
    brandRoot: '/tmp/omega-manager-recaptcha-unused',
    brandConfig: brandConfig({ siteKey: null }),
    targets: [],
    operations: OPERATIONS.captcha,
    options: {},
    serviceData: {},
  });

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /missing RECAPTCHA_SECRET_KEY/);
  assert.doesNotMatch(result.reason, /RECAPTCHA_SITE_KEY/);
  assert.deepEqual(result.missingEnv, ['RECAPTCHA_SECRET_KEY']);
});

test('captcha: captcha.providers.recaptcha.enabled = false skips the service', async () => {
  const config = brandConfig();
  config.captcha.providers.recaptcha.enabled = false;

  const result = await runService(config, { recaptcha: fakeRecaptcha() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /captcha\.providers\.recaptcha\.enabled/);
});

test('captcha: skips without brand.url', async () => {
  const result = await runService(brandConfig({ url: '' }), { recaptcha: fakeRecaptcha() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /brand\.url/);
});

// ─── Half-keyed brand (#507) ─────────────────────────────────────────────────

// A setup-time throw is how a service fails the walk: manage.js's runService
// catches it into { status: 'error', error } for the run summary
test('captcha: the secret without the config site key fails the service', async () => {
  // The playground's live-checkout 403 state: the backend enforces token
  // verification, the client has no key to mint a token with
  await assert.rejects(
    () => runService(brandConfig({ siteKey: null }), { recaptcha: fakeRecaptcha() }),
    (error) => {
      assert.match(error.message, /captcha\.providers\.recaptcha\.siteKey is missing from config/);
      assert.match(error.message, /https:\/\/www\.google\.com\/recaptcha\/admin/);
      return true;
    },
  );
});

test('captcha: the config site key without the secret fails, deep-linking the key page', async () => {
  const config = brandConfig();
  config.cloud = { provider: 'firebase', config: { projectId: 'fixture-brand-cloud' } };

  await assert.rejects(
    () => runService(config, { recaptcha: fakeRecaptcha(), env: false }),
    (error) => {
      assert.match(error.message, /RECAPTCHA_SECRET_KEY is missing from the brand \.env/);
      // The #444 deep-link pattern, reused verbatim
      assert.match(
        error.message,
        new RegExp(`https://console\\.cloud\\.google\\.com/security/recaptcha/${SITE_KEY}/overview\\?from=keysList&project=fixture-brand-cloud`),
      );
      return true;
    },
  );
});

test('captcha: neither half is the sanctioned unkeyed brand — it skips, never fails (#17)', async () => {
  const result = await runService(brandConfig({ siteKey: null }), { env: false });

  assert.equal(result.status, 'skipped');
});

// ─── Secret validation ───────────────────────────────────────────────────────

test('captcha: valid secret is a success with exactly one read probe', async () => {
  const api = fakeRecaptcha(); // invalid-input-response = the probe token was rejected, the secret was not

  const result = await runService(brandConfig(), { recaptcha: api });

  assert.equal(result.status, 'success');
  assert.equal(result.output.siteKey.secretValid, true);
  // #444: the bare domain only — the www twin is never recommended
  assert.deepEqual(result.output.siteKey.domains, [DOMAIN]);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].method, 'verify');
});

test('captcha: invalid secret fails the service with .env guidance', async () => {
  const api = fakeRecaptcha({ errorCodes: ['invalid-input-secret'] });

  const result = await runService(brandConfig(), { recaptcha: api });

  assert.equal(result.status, 'error');
  assert.match(result.error, /RECAPTCHA_SECRET_KEY is invalid/);
});

// ─── Console URL (de-ITW'd) ──────────────────────────────────────────────────

test('captcha: no project at any layer → generic classic admin console URL', async () => {
  const result = await runService(brandConfig(), { recaptcha: fakeRecaptcha() });

  // omega-manager hardcoded ?project=itw-creative-works — the default must
  // carry no company value at all
  assert.equal(result.output.siteKey.consoleUrl, 'https://www.google.com/recaptcha/admin');
});

test('captcha: captcha.providers.recaptcha.project deep-links the cloud console key page', async () => {
  const config = brandConfig();
  config.captcha.providers.recaptcha.project = 'my-shared-project';

  const result = await runService(config, { recaptcha: fakeRecaptcha() });

  assert.equal(
    result.output.siteKey.consoleUrl,
    `https://console.cloud.google.com/security/recaptcha/${SITE_KEY}/overview?from=keysList&project=my-shared-project`,
  );
});

test('captcha: cloud.config.projectId deep-links by default, with no captcha project set', async () => {
  // #444: the key lives in the brand's own cloud project — the deep link must
  // build without anyone setting a second copy of the project id
  const config = brandConfig();
  config.cloud = { provider: 'firebase', config: { projectId: 'fixture-brand-cloud' } };

  const result = await runService(config, { recaptcha: fakeRecaptcha() });

  assert.equal(config.captcha.providers.recaptcha.project, null);
  assert.equal(
    result.output.siteKey.consoleUrl,
    `https://console.cloud.google.com/security/recaptcha/${SITE_KEY}/overview?from=keysList&project=fixture-brand-cloud`,
  );
});

test('captcha: captcha.providers.recaptcha.project wins over cloud.config.projectId', async () => {
  // The per-provider key exists for a key minted OUTSIDE the brand's project
  const config = brandConfig();
  config.cloud = { provider: 'firebase', config: { projectId: 'fixture-brand-cloud' } };
  config.captcha.providers.recaptcha.project = 'my-shared-project';

  const result = await runService(config, { recaptcha: fakeRecaptcha() });

  assert.match(result.output.siteKey.consoleUrl, /project=my-shared-project$/);
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('captcha: dry-run behaves identically — the probe is a pure read', async () => {
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
  const brandRoot = makeBrandRoot(fixtureConfigSource());

  try {
    const run = runService(brandConfig(), { recaptcha: api, brandRoot });
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
    // The confirm's ONE home is omega.json5 (#434)
    assert.match(readConfigSource(brandRoot), new RegExp(`domainsConfirmed:\\s*\\[\\s*['"]${DOMAIN}['"],?\\s*\\]`));
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
  const env = REQUIRES.captcha.env;
  assert.deepEqual(env.map((e) => e.name), ['RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY']);
  for (const entry of env) {
    assert.equal(entry.url, 'https://console.cloud.google.com/security/recaptcha');
    assert.equal(entry.prompted, true);
  }
});

test('requires/defaults: no ITW or hardcoded key value anywhere in the recaptcha registry', () => {
  // The paste flow must be the only path to a key — no default value exists
  assert.equal(DEFAULTS.captcha.providers.recaptcha.project, null);
  const serialized = JSON.stringify({ defaults: DEFAULTS.captcha.providers.recaptcha, requires: { why: REQUIRES.captcha.why, env: REQUIRES.captcha.env } });
  assert.doesNotMatch(serialized, /itw/i);
  assert.doesNotMatch(serialized, /6L[0-9A-Za-z_-]{38}/); // a real site-key literal
});

test('recaptcha service source carries no hardcoded key or company value', () => {
  const serviceDir = path.join(__dirname, '../src/services/captcha');
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
    const config = brandConfig();
    config.captcha.providers.recaptcha.domainsConfirmed = [DOMAIN];
    const result = await runService(config, { recaptcha: api });

    assert.equal(result.status, 'success');
    assert.deepEqual(opened, []); // no browser, no prompt — the run resolved unattended
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('site-key: a stamp carrying the old www twin confirms without churn and narrows to bare', async () => {
  // #444: dropping the www recommendation must not re-prompt every brand that
  // already confirmed [domain, www.domain] — the bare domain is already listed
  const api = fakeRecaptcha();
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt(); // interactive — a stale stamp WOULD prompt

  try {
    const stamped = [DOMAIN, `www.${DOMAIN}`];
    const config = brandConfig();
    config.captcha.providers.recaptcha.domainsConfirmed = stamped;
    const brandRoot = makeBrandRoot(fixtureConfigSource({ domainsConfirmed: stamped }));
    const result = await runService(config, { recaptcha: api, brandRoot });

    assert.equal(result.status, 'success');
    assert.deepEqual(opened, []);
    // The on-disk stamp narrowed to the bare domain
    const source = readConfigSource(brandRoot);
    assert.match(source, new RegExp(`domainsConfirmed:\\s*\\[\\s*['"]${DOMAIN}['"],?\\s*\\]`));
    assert.doesNotMatch(source, /www\./);
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('site-key: a stamp for a different domain still re-prompts', async () => {
  // The narrowing must not swallow a genuinely changed brand.url
  const api = fakeRecaptcha();
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });

  // No tty here — the unconfirmed path falls through to the printed guidance
  const config = brandConfig();
  config.captcha.providers.recaptcha.domainsConfirmed = ['old-brand.test'];
  const brandRoot = makeBrandRoot(fixtureConfigSource({ domainsConfirmed: ['old-brand.test'] }));
  const result = await runService(config, { recaptcha: api, brandRoot });

  setBrowserOpener(null);

  assert.equal(result.status, 'success');
  // The stale stamp is left exactly as it was — nothing was confirmed, so
  // nothing narrowed to the new bare domain
  assert.match(readConfigSource(brandRoot), /domainsConfirmed:\s*\[\s*['"]old-brand\.test['"],?\s*\]/);
  assert.deepEqual(opened, []);
});

/**
 * Unit tests for @omega.js/config's validate module — schema validation
 * (shared + per-target refinements), the `runSchema` primitive, and error
 * formatting. (File discovery + the full resolution chain are covered by
 * load.test.js.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateConfig,
  runSchema,
  formatErrors,
  TARGETS,
} = require('../src/index.js');

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

test('email identity keys are optional but typed when present', () => {
  // The email path reads these instead of carrying a built-in identity
  // (packages/backend docs/email-system.md → "Identity is config, or it is an error").
  const configured = validateConfig({
    ...VALID,
    brand: {
      ...VALID.brand,
      company: 'Sandbox Holdings Inc',
      contact: {
        email: 'hello@sandbox.example',
        person: { name: 'Jane Doe, CEO', firstName: 'Jane', image: 'https://x.com/j.jpg', url: 'https://jane.example', urlText: '@jane' },
        carbonCopy: [{ email: 'audit@sandbox.example', name: 'Audit' }],
      },
      images: { companyWordmark: 'https://x.com/wordmark.png' },
    },
  });

  assert.deepStrictEqual(configured.errors, []);
  // Absence is fine — a brand that sends no personal email configures none of it.
  assert.deepStrictEqual(validateConfig(VALID).errors, []);

  const { errors } = validateConfig({
    ...VALID,
    brand: { ...VALID.brand, contact: { person: { name: 42, url: 'ftp://nope' }, carbonCopy: 'not-an-array' } },
  });

  assert.ok(errors.some((e) => e.includes('config.brand.contact.person.name has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.brand.contact.person.url') && e.includes('does not match')));
  assert.ok(errors.some((e) => e.includes('config.brand.contact.carbonCopy has wrong type')));
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

test('auth.signup.maxPerIpPerDay is a positive integer (backend rule, #133)', () => {
  const opts = { target: 'backend' };

  // A brand raising the per-IP cap (shared NAT/CGNAT/VPN egress)
  assert.deepStrictEqual(validateConfig({ ...VALID, auth: { signup: { maxPerIpPerDay: 25 } } }, opts).errors, []);
  // Absent = the framework default (2) applies
  assert.deepStrictEqual(validateConfig(VALID, opts).errors, []);

  for (const value of [0, -1, 2.5]) {
    const { errors } = validateConfig({ ...VALID, auth: { signup: { maxPerIpPerDay: value } } }, opts);
    assert.ok(
      errors.some((e) => e.includes('config.auth.signup.maxPerIpPerDay')),
      `${value} must fail validation; the cap is a positive integer`,
    );
  }

  const { errors } = validateConfig({ ...VALID, auth: { signup: { maxPerIpPerDay: '2' } } }, opts);
  assert.ok(errors.some((e) => e.includes('config.auth.signup.maxPerIpPerDay has wrong type') && e.includes('integer')));
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

test('desktop releases.enabled is a declared key: booleans pass, a string bounces (#124)', () => {
  const gated = { ...VALID, releases: { enabled: false, repo: 'acme-site' } };
  assert.deepStrictEqual(validateConfig(gated, { target: 'desktop' }).errors, []);

  const { errors } = validateConfig(
    { ...VALID, releases: { enabled: 'nope' } },
    { target: 'desktop' },
  );
  assert.ok(errors.some((e) => e.includes('config.releases.enabled has wrong type')));
});

test('extension listings are declared keys: valid urls pass, a non-url bounces (#85)', () => {
  const listed = {
    ...VALID,
    listings: {
      chrome: { url: 'https://chromewebstore.google.com/detail/x', state: 'live' },
      firefox: { url: 'https://addons.mozilla.org/x' },
      edge: { url: 'https://microsoftedge.microsoft.com/addons/x' },
    },
  };
  assert.deepStrictEqual(validateConfig(listed, { target: 'extension' }).errors, []);

  const { errors } = validateConfig(
    { ...VALID, listings: { chrome: { url: 'not-a-url' } } },
    { target: 'extension' },
  );
  assert.ok(errors.some((e) => e.includes('config.listings.chrome.url') && e.includes('does not match')));
});

test('unknown options.target throws (programmer error, not a config error)', () => {
  assert.throws(() => validateConfig(VALID, { target: 'website' }), /Unknown target "website"/);
});

// ─── validateConfig: secrets ───

test('secret-shaped keys are validation errors', () => {
  const { errors } = validateConfig({ ...VALID, payment: { processors: { stripe: { apiSecret: 'x' } } } });

  assert.ok(errors.some((e) => e.includes('config.payment.processors.stripe.apiSecret looks like a secret')));
});

// ─── validateConfig: authDomain is the brand's own host (cp268) ───

test('an authDomain equal to the brand host passes (the playground shape)', () => {
  const { errors } = validateConfig({
    ...VALID,
    brand: { ...VALID.brand, url: 'https://playground.omegajs.dev' },
    cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'playground.omegajs.dev' } },
  });

  assert.deepStrictEqual(errors, []);
});

test('a firebaseapp.com authDomain hard-fails, naming the self-hosted requirement', () => {
  const { errors } = validateConfig({
    ...VALID,
    brand: { ...VALID.brand, url: 'https://playground.omegajs.dev' },
    cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'omegajs-playground.firebaseapp.com' } },
  });

  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes('config.cloud.config.authDomain'));
  assert.ok(errors[0].includes('firebaseapp.com'));
  assert.ok(errors[0].includes('/__/auth/*'), 'the message says self-hosting is the requirement');
});

test('an authDomain on another host fails, naming both values', () => {
  const { errors } = validateConfig({
    ...VALID,
    brand: { ...VALID.brand, url: 'https://playground.omegajs.dev' },
    cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'auth.other.example' } },
  });

  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes('auth.other.example'), 'the configured value');
  assert.ok(errors[0].includes('playground.omegajs.dev'), 'the brand host');
});

test("an instance's own url wins over brand.url for the host comparison", () => {
  const base = {
    ...VALID,
    brand: { ...VALID.brand, url: 'https://playground.omegajs.dev' },
    cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'admin.omegajs.dev' } },
  };

  // The target chain merges the instance entry to the top level, so its `url`
  // is the resolved brand host for THIS app
  assert.deepStrictEqual(validateConfig({ ...base, url: 'https://admin.omegajs.dev' }, { target: 'web' }).errors, []);
  assert.strictEqual(validateConfig(base, { target: 'web' }).errors.length, 1, 'without the instance url it is a mismatch');
});

test('an absent authDomain passes, and a demo-* project is exempt', () => {
  const absent = validateConfig({
    ...VALID,
    brand: { ...VALID.brand, url: 'https://sandbox-brand.example.com' },
    cloud: { provider: 'firebase', config: { projectId: 'demo-sandbox-brand' } },
  });
  assert.deepStrictEqual(absent.errors, []);

  // demo-* is emulator-only: no real project, no redirect sign-in
  const demo = validateConfig({
    ...VALID,
    brand: { ...VALID.brand, url: 'https://sandbox-brand.example.com' },
    cloud: { provider: 'firebase', config: { projectId: 'demo-sandbox-brand', authDomain: 'demo-sandbox-brand.firebaseapp.com' } },
  });
  assert.deepStrictEqual(demo.errors, []);
});

// ─── validateConfig: retired keys (#142) ───

test('a retired key is an error wherever it sits — shared level and inside a target', () => {
  const shared = validateConfig({ ...VALID, web_manager: { auth: { enabled: true } } });
  assert.ok(shared.errors.some((e) => e.includes('config.web_manager')
    && e.includes('web_manager') && e.includes('client')), 'shared-level web_manager bounces');

  const scoped = validateConfig({ ...VALID, targets: { web: { web_manager: { chatsy: {} } } } });
  assert.ok(scoped.errors.some((e) => e.includes('config.targets.web.web_manager')
    && e.includes('client')), 'target-level web_manager bounces');

  // The message names the doc row, so the fix does not need a search.
  assert.ok(scoped.errors.some((e) => e.includes('docs/shared/config.md')), 'the mapping table is cited');
});

test('the retired firebaseConfig key is an error; its replacement passes', () => {
  const { errors } = validateConfig({ ...VALID, firebaseConfig: { projectId: 'acme' } });
  assert.ok(errors.some((e) => e.includes('config.firebaseConfig') && e.includes('cloud')));

  assert.deepStrictEqual(
    validateConfig({ ...VALID, cloud: { provider: 'firebase', config: { projectId: 'acme' } } }).errors,
    [],
  );
});

test('the current client key is untouched by the retired-key guard', () => {
  const config = { ...VALID, targets: { web: { client: { auth: {}, chatsy: {}, cookieConsent: {} } } } };

  assert.deepStrictEqual(validateConfig(config).errors, []);
});

// ─── validateConfig: retired PATHS — the de-branding rekey (#23) ───

test('every de-branded top-level key hard-fails and names its new home', () => {
  const moved = {
    slapform: 'forms.providers.slapform',
    chatsy: 'inbound.chat.providers.chatsy',
    replyify: 'inbound.email.providers.replyify',
    cloudflare: 'edge.providers.cloudflare',
    recaptcha: 'captcha.providers.recaptcha',
    searchConsole: 'search.providers.searchConsole',
    gcp: 'cloud',
    firebase: 'cloud',
  };

  for (const [key, replacement] of Object.entries(moved)) {
    const { errors } = validateConfig({ ...VALID, [key]: {} });
    assert.ok(
      errors.some((e) => e.includes(`config.${key} is retired`) && e.includes(replacement)),
      `${key} must bounce toward ${replacement}`,
    );
  }
});

test('the retired google-adsense provider id bounces at its nested path', () => {
  const { errors } = validateConfig({
    ...VALID,
    advertising: { providers: { 'google-adsense': { client: 'ca-pub-1' } } },
  });

  assert.ok(errors.some((e) => e.includes('config.advertising.providers.google-adsense is retired')
    && e.includes('advertising.providers.adsense')));
});

test('the new homes themselves validate clean — the provider keeps its own name one level down', () => {
  const config = {
    ...VALID,
    forms: { providers: { slapform: { formId: 'abc' } } },
    inbound: {
      chat: { providers: { chatsy: { agentId: 'abc', settings: {} } } },
      email: { providers: { replyify: { agentId: 'abc' } } },
    },
    edge: { providers: { cloudflare: { zone: 'zone-id' } } },
    captcha: { providers: { recaptcha: { siteKey: 'key' } } },
    search: { providers: { searchConsole: { submitSitemap: false } } },
    repo: { providers: { github: { org: 'Acme-Org' } } },
    cloud: { provider: 'firebase', config: { projectId: 'acme' }, organizationId: false, billingAccount: false },
    advertising: { providers: { adsense: { client: 'ca-pub-1', displaySlot: '1' } } },
  };

  assert.deepStrictEqual(validateConfig(config).errors, []);
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

test('integer type + min bound: only whole numbers at or above the bound pass', () => {
  const schema = [{ path: 'limits.perDay', type: 'integer', min: 1 }];

  assert.deepStrictEqual(runSchema({ limits: { perDay: 1 } }, schema), []);
  assert.deepStrictEqual(runSchema({ limits: { perDay: 99 } }, schema), []);
  assert.strictEqual(runSchema({ limits: { perDay: 1.5 } }, schema).length, 1);
  assert.match(runSchema({ limits: { perDay: 0 } }, schema)[0], /limits\.perDay 0 is below the minimum 1/);
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

// ─── formatErrors ───

test('formatErrors renders a numbered block; empty list renders empty', () => {
  assert.strictEqual(formatErrors([]), '');
  assert.strictEqual(formatErrors(['a', 'b']), '  1. a\n  2. b');
});

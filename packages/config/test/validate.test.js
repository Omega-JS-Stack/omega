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

test("parent accepts 'self', a URL string, or the deliberate false opt-out: union types (shared rule, #277)", () => {
  assert.deepStrictEqual(validateConfig({ ...VALID, parent: 'self' }).errors, []);
  assert.deepStrictEqual(validateConfig({ ...VALID, parent: 'https://api.example.com' }).errors, []);
  // false = "shared webhook account owned elsewhere" (the playground's shape)
  assert.deepStrictEqual(validateConfig({ ...VALID, parent: false }).errors, []);

  const { errors } = validateConfig({ ...VALID, parent: 42 });
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

test('the six manager-level sections are shared keys: a website-only brand carries them at the top level (#277)', () => {
  // The manager reads these at brand level UNFOLDED (manage.js loads the brand
  // config with no target), so a brand whose only target is web still needs a
  // home for them, and adding targets.backend just to hold them would falsely
  // enable the target.
  const websiteOnly = {
    ...VALID,
    targets: { web: {} },
    parent: 'https://itwcreativeworks.com',
    github: { user: 'itw-creative-works', website: 'https://github.com/itw-creative-works/clockii' },
    reviews: { enabled: true, sites: ['trustpilot.com'] },
    marketing: { campaigns: { enabled: true, platform: 'sendgrid' }, prune: { enabled: true } },
    blog: { enabled: false },
    dataRequest: { queries: [] },
  };

  assert.deepStrictEqual(validateConfig(websiteOnly).errors, []);
  assert.deepStrictEqual(validateConfig(websiteOnly, { target: 'web' }).errors, []);

  // Shared keys are TYPED shared too: no backend target needed to catch a shape mistake.
  const { errors } = validateConfig({ ...VALID, parent: 42, github: 'itw', reviews: 'yes', marketing: [1], blog: 'on', dataRequest: 3 });
  assert.ok(errors.some((e) => e.includes('config.parent has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.github has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.reviews has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.marketing has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.blog has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.dataRequest has wrong type')));
});

test('directory + sponsorships are shared keys, typed shared, and secret-free (#246)', () => {
  // The manager's directory service reads both at brand level, unfolded, the
  // same way as the #277 six.
  const participating = {
    ...VALID,
    targets: { web: {} },
    parent: 'https://itwcreativeworks.com',
    directory: { enabled: true },
    sponsorships: {
      acceptable: ['tech'],
      unacceptable: ['gambling'],
      prices: { 'guest-post': 70, 'link-insertion': 50 },
    },
  };

  assert.deepStrictEqual(validateConfig(participating).errors, []);
  assert.deepStrictEqual(validateConfig(participating, { target: 'web' }).errors, []);

  const { errors } = validateConfig({
    ...VALID,
    directory: { enabled: 'yes' },
    sponsorships: { acceptable: 'tech', unacceptable: 'gambling', prices: [70] },
  });
  assert.ok(errors.some((e) => e.includes('config.directory.enabled has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.sponsorships.acceptable has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.sponsorships.unacceptable has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.sponsorships.prices has wrong type')));

  // The entry is pushed into a world-readable collection: the secret-shape
  // guard is the hard floor on what a brand can put in these sections.
  const secret = validateConfig({ ...VALID, sponsorships: { apiSecret: 'sk_live_x' } });
  assert.ok(secret.errors.some((e) => e.includes('config.sponsorships.apiSecret looks like a secret')));
});

test('an unrecognized top-level key stays unvalidated: the move admits six NAMED keys, not a permissiveness change (#277)', () => {
  // No unknown-top-level-key rejection exists anywhere in the validator: only
  // unknown TARGET names, retired keys, and secret-shaped keys are errors.
  // This guards the move against changing that either way.
  assert.deepStrictEqual(validateConfig({ ...VALID, bogusSection: { a: 1 } }).errors, []);

  // Retired + secret-shaped keys still bounce alongside a bogus one.
  const { errors } = validateConfig({
    ...VALID,
    bogusSection: { a: 1 },
    payment: { processors: { stripe: { apiSecret: 'x' } } },
  });
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes('config.payment.processors.stripe.apiSecret looks like a secret'));
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
  const config = { ...VALID, targets: { web: { client: { auth: {}, chatsy: {}, consent: {} } } } };

  assert.deepStrictEqual(validateConfig(config).errors, []);
});

test('the retired cookieConsent key is an error and names client.consent (#383)', () => {
  // It sat INSIDE the client blob, which is exactly where a name test has to
  // reach: the block was renamed, so a config still carrying it would lose its
  // banner settings silently.
  const { errors } = validateConfig({ ...VALID, targets: { web: { client: { cookieConsent: { enabled: false } } } } });

  assert.ok(
    errors.some((e) => e.includes('config.targets.web.client.cookieConsent') && e.includes('client.consent')),
    'the old block bounces and names its replacement',
  );
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

// #272 — brand.color is documented (packages/web/README.md) and consumed by
// the engine (head.html builds the --omega-accent ramps from it), so the
// schema owes it a shape: the ramp composer reads a hex string.
test('brand.color is optional, hex-validated when present', () => {
  assert.deepStrictEqual(validateConfig({ ...VALID, brand: { ...VALID.brand, color: '#4F46E5' } }).errors, [], 'a 6-digit hex passes');
  assert.deepStrictEqual(validateConfig({ ...VALID, brand: { ...VALID.brand, color: '#f0a' } }).errors, [], 'the 3-digit form passes');
  assert.deepStrictEqual(validateConfig(VALID).errors, [], 'absence stays valid');

  const junk = validateConfig({ ...VALID, brand: { ...VALID.brand, color: 'indigo' } });
  assert.ok(junk.errors.some((e) => e.includes('config.brand.color') && e.includes('does not match')), `a non-hex color fails loudly: ${junk.errors.join(' | ')}`);

  const typed = validateConfig({ ...VALID, brand: { ...VALID.brand, color: 0x4F46E5 } });
  assert.ok(typed.errors.some((e) => e.includes('config.brand.color has wrong type')), 'a number is not a color');
});

// #250 — the purge pass now READS targets.web.purgecss.safelist
// (packages/web/src/assets.js mergeSafelist), so the schema owes it a shape:
// the object form's lanes and the array shorthand PurgeCSS itself accepts.
test('targets.web.purgecss.safelist is declared — both accepted shapes pass, a mistyped one is loud', () => {
  const lanes = validateConfig({
    ...VALID,
    purgecss: { safelist: { standard: ['collapse'], deep: ['^tooltip'], greedy: ['^brand-'], keyframes: ['^fade'] } },
  }, { target: 'web' });
  assert.deepStrictEqual(lanes.errors, [], 'every lane takes an array of string patterns');

  // PurgeCSS's own shorthand: a bare array IS the standard lane.
  assert.deepStrictEqual(validateConfig({ ...VALID, purgecss: { safelist: ['collapse'] } }, { target: 'web' }).errors, [], 'the array shorthand passes');
  assert.deepStrictEqual(validateConfig(VALID, { target: 'web' }).errors, [], 'absence stays valid');

  // The typo that used to purge a brand's classes silently.
  const bare = validateConfig({ ...VALID, purgecss: { safelist: 'brand-' } }, { target: 'web' });
  assert.ok(bare.errors.some((e) => e.includes('config.purgecss.safelist has wrong type')), `a bare string is not a safelist: ${bare.errors.join(' | ')}`);

  const lane = validateConfig({ ...VALID, purgecss: { safelist: { greedy: '^brand-' } } }, { target: 'web' });
  assert.ok(lane.errors.some((e) => e.includes('config.purgecss.safelist.greedy has wrong type')), `a lane takes an array, not one pattern: ${lane.errors.join(' | ')}`);

  const section = validateConfig({ ...VALID, purgecss: ['collapse'] }, { target: 'web' });
  assert.ok(section.errors.some((e) => e.includes('config.purgecss has wrong type')), 'the section itself is an object');
});

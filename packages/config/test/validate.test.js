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

test('translation section: valid shape passes, providers block + types enforced', () => {
  assert.deepStrictEqual(
    validateConfig({
      ...VALID,
      translation: { enabled: true, default: 'en', languages: ['es', 'fr'], providers: { claude: {} }, exclude: ['blog'] },
    }).errors,
    [],
  );

  const { errors } = validateConfig({
    ...VALID,
    translation: { languages: 'es', providers: 'chatgpt' },
  });

  assert.ok(errors.some((e) => e.includes('config.translation.languages has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.translation.providers has wrong type')));
});

test('the flat provider picks are retired — one providers block per role (#425)', () => {
  const { errors } = validateConfig({
    ...VALID,
    translation: { languages: ['es'], provider: 'chatgpt' },
    domain: { provider: 'namecheap', email: { provider: 'cloudflare' } },
    devlog: { enabled: true, provider: 'ghostii', orgs: ['x'] },
    certificates: { apple: { bundleIdPrefix: 'com.acme' } },
    payment: { processors: { stripe: { publishableKey: 'pk_test_x' } } },
  });

  for (const [path, replacement] of [
    ['translation.provider', 'translation.providers.<name>'],
    ['domain.provider', 'domain.providers.<registrar>'],
    ['domain.email.provider', 'domain.email.providers.<provider>'],
    ['devlog.provider', 'devlog.providers.ghostii'],
    ['devlog.orgs', 'devlog.providers.ghostii.orgs'],
    ['certificates.apple', 'certificates.providers.apple'],
    ['payment.processors', 'payment.providers'],
  ]) {
    assert.ok(
      errors.some((e) => e.includes(`config.${path} is retired`) && e.includes(`now "${replacement}"`)),
      `${path} should bounce with its ${replacement} replacement`,
    );
  }
});

test('every converted monitoring + marketing leaf is retired by its exact path (#425)', () => {
  const { errors } = validateConfig({
    ...VALID,
    monitoring: {
      provider: 'sentry',
      org: 'acme-co',
      dsn: 'https://x@sentry.test/1',
      environment: 'production',
      sampleRate: 1,
      tracesSampleRate: 0.1,
      scrubEmail: true,
      attachScreenshot: false,
      bundlePatterns: ['/assets/js/'],
    },
    marketing: {
      campaigns: { provider: 'sendgrid', listId: 'lst_1' },
      newsletter: { provider: 'beehiiv', publicationId: 'pub_1' },
    },
    blog: { provider: 'ghostii' },
  });

  for (const [path, replacement] of [
    ['monitoring.provider', 'monitoring.providers.sentry'],
    ['monitoring.org', 'monitoring.providers.sentry.org'],
    ['monitoring.dsn', 'monitoring.providers.sentry.dsn'],
    ['monitoring.environment', 'monitoring.providers.sentry.environment'],
    ['monitoring.sampleRate', 'monitoring.providers.sentry.sampleRate'],
    ['monitoring.tracesSampleRate', 'monitoring.providers.sentry.tracesSampleRate'],
    ['monitoring.scrubEmail', 'monitoring.providers.sentry.scrubEmail'],
    ['monitoring.attachScreenshot', 'monitoring.providers.sentry.attachScreenshot'],
    ['monitoring.bundlePatterns', 'monitoring.providers.sentry.bundlePatterns'],
    ['marketing.campaigns.provider', 'marketing.campaigns.providers.sendgrid'],
    ['marketing.campaigns.listId', 'marketing.campaigns.providers.sendgrid.listId'],
    ['marketing.newsletter.provider', 'marketing.newsletter.providers.beehiiv'],
    ['marketing.newsletter.publicationId', 'marketing.newsletter.providers.beehiiv.publicationId'],
    ['blog.provider', 'blog.providers.ghostii'],
  ]) {
    assert.ok(
      errors.some((e) => e.includes(`config.${path} is retired`) && e.includes(`now "${replacement}"`)),
      `${path} should bounce with its ${replacement} replacement`,
    );
  }
});

test('monitoring + marketing in the new shape validate clean, and their role-level keys stay put (#425)', () => {
  assert.deepStrictEqual(
    validateConfig({
      ...VALID,
      monitoring: {
        enabled: true,
        providers: { sentry: { org: 'acme-co', dsn: 'https://x@sentry.test/1', sampleRate: 1, scrubEmail: false, bundlePatterns: ['/assets/js/'] } },
      },
      marketing: {
        campaigns: { enabled: true, providers: { sendgrid: { listId: 'lst_1' } } },
        newsletter: { enabled: false, providers: { beehiiv: { publicationId: 'pub_1' } }, content: [{ tone: 'practical' }] },
        prune: { enabled: true },
      },
    }).errors,
    [],
  );

  // …and the provider-hung leaves are typed, so a wrong shape still fails
  const { errors } = validateConfig({
    ...VALID,
    monitoring: { providers: { sentry: { dsn: 'sentry.test/1', sampleRate: 2 } } },
    marketing: { campaigns: { enabled: 'yes', providers: { sendgrid: { listId: 42 } } } },
  });

  assert.ok(errors.some((e) => e.includes('config.monitoring.providers.sentry.dsn') && e.includes('does not match')));
  assert.ok(errors.some((e) => e.includes('config.monitoring.providers.sentry.sampleRate') && e.includes('above the maximum')));
  assert.ok(errors.some((e) => e.includes('config.marketing.campaigns.enabled has wrong type')));
  assert.ok(errors.some((e) => e.includes('config.marketing.campaigns.providers.sendgrid.listId has wrong type')));
});

test('devlog + seo are schema-known optional objects (manager-read sections)', () => {
  assert.deepStrictEqual(
    validateConfig({ ...VALID, devlog: { enabled: true, providers: { ghostii: { orgs: ['x'] } } }, seo: { github: { content: [] } } }).errors,
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
    marketing: { campaigns: { enabled: true, providers: { sendgrid: { listId: 'lst_1' } } }, prune: { enabled: true } },
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
    payment: { providers: { stripe: { apiSecret: 'x' } } },
  });
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes('config.payment.providers.stripe.apiSecret looks like a secret'));
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
  const { errors } = validateConfig({ ...VALID, payment: { providers: { stripe: { apiSecret: 'x' } } } });

  assert.ok(errors.some((e) => e.includes('config.payment.providers.stripe.apiSecret looks like a secret')));
});

// ─── validateConfig: a product price is a number (#674) ───

test('a bare-number price catalog passes, at every frequency and for `once`', () => {
  const { errors } = validateConfig({
    ...VALID,
    payment: {
      products: [
        { id: 'premium', type: 'subscription', prices: { monthly: 9.99, annually: 99.99 } },
        { id: 'credits', type: 'one-time', prices: { once: 49.99 } },
        { id: 'basic', type: 'subscription' },
      ],
    },
  });

  assert.deepStrictEqual(errors, []);
});

test('an object-shaped price is refused, naming the product and the key (#674)', () => {
  // The disagreement it closes: the checkout page unwrapped `{ amount: N }` and
  // every backend reader took the bare number, so this shape priced the summary
  // correctly and put `[object Object]` in the confirmation URL's amount.
  const { errors } = validateConfig({
    ...VALID,
    payment: {
      products: [{ id: 'credits', type: 'one-time', prices: { once: { amount: 49.99 } } }],
    },
  });

  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('config.payment.products'), errors[0]);
  assert.ok(errors[0].includes('credits'), errors[0]);
  assert.ok(errors[0].includes('once'), errors[0]);
});

test('a subscription price carrying the same object shape is refused too (#674)', () => {
  const { errors } = validateConfig({
    ...VALID,
    payment: { products: [{ id: 'premium', type: 'subscription', prices: { monthly: { amount: 9.99 }, annually: 99.99 } }] },
  });

  assert.equal(errors.length, 1, errors.join(' | '));
  assert.ok(errors[0].includes('monthly'), errors[0]);
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

// #588 (Ian 2026-09-01): the authDomain is a BRAND fact. One Firebase project,
// one backend, shared by every instance a brand runs, so the comparison reads
// brand.url and never the instance's own top-level `url` (which a multi-instance
// target now derives from the instance id). Reading it the other way made a
// `targets/website-admin` load fail its own brand's authDomain.
test('authDomain compares against the BRAND host, never the instance url', () => {
  const base = {
    ...VALID,
    brand: { ...VALID.brand, url: 'https://playground.omegajs.dev' },
    cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'playground.omegajs.dev' } },
  };

  assert.deepStrictEqual(
    validateConfig({ ...base, url: 'https://admin.omegajs.dev' }, { target: 'web' }).errors,
    [],
    "an instance's url does not turn the brand's own authDomain into a mismatch",
  );

  // ... and it licenses nothing either: an authDomain on the INSTANCE host is
  // still the mismatch it was, named against the brand host
  const onInstanceHost = validateConfig({
    ...base,
    url: 'https://admin.omegajs.dev',
    cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'admin.omegajs.dev' } },
  }, { target: 'web' });

  assert.strictEqual(onInstanceHost.errors.length, 1);
  assert.ok(onInstanceHost.errors[0].includes('playground.omegajs.dev'), 'the brand host is what it names');
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

test('#610: the legacy download and extension page maps are retired — site.targets is the one home', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: {
      web: {
        download: { mac: { universal: 'https://acme.com/dl/mac' } },
        extension: { chrome: 'https://acme.com/ext' },
      },
    },
  });

  assert.ok(
    errors.some((e) => e.includes('config.targets.web.download') && e.includes('targets.desktop.releases')),
    'the download map bounces and names the block it derives from',
  );
  assert.ok(
    errors.some((e) => e.includes('config.targets.web.extension') && e.includes('targets.extension.listings')),
    'the extension map bounces and names the listings it derives from',
  );

  // The blocks they derive FROM are untouched.
  assert.deepStrictEqual(
    validateConfig({
      ...VALID,
      targets: { desktop: { releases: {} }, extension: { listings: { chrome: { url: 'https://store/x' } } } },
    }).errors,
    [],
  );
});

test('#466: the web redirect map is retired — the edge owns templated redirects', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: { web: { redirects: [{ from: '/c/:id', to: '/code?id=:id' }] } },
  });

  assert.ok(
    errors.some((e) => e.includes('config.targets.web.redirects') && e.includes('edge.providers.cloudflare.rules.redirect')),
    'the map bounces and names the Cloudflare ruleset that answers it now',
  );

  // The two mechanisms that replaced it are both untouched.
  assert.deepStrictEqual(
    validateConfig({
      ...VALID,
      edge: { providers: { cloudflare: { rules: { redirect: [{ name: 'Redirect: QR short code' }] } } } },
    }).errors,
    [],
  );
});

test('#737: the desktop webpack externals override is retired — esbuild has no consumer knob', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: { desktop: { em: { webpack: { externals: ['better-sqlite3'] } } } },
  });

  assert.ok(
    errors.some((e) => e.includes('config.targets.desktop.em.webpack.externals') && e.includes('esbuild')),
    'the override bounces instead of riding the exempt `targets` namespace unnoticed',
  );
});

test('#799: every downloads mirror key is retired and points at the one releases repo', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: { desktop: { downloads: { enabled: true, owner: 'Acme-Org', repo: 'download-server', tag: 'installer' } } },
  });

  for (const key of ['enabled', 'owner', 'repo', 'tag']) {
    assert.ok(
      errors.some((e) => e.includes(`config.targets.desktop.downloads.${key} is retired`) && e.includes('#799')),
      `downloads.${key} should bounce naming the releases repo that replaced the mirror`,
    );
  }
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

// #628 — #527 collapsed adsense to ONE switch, the `client` id, and deleted
// the service's `enabled === false` skip with it. A brand still carrying that
// gate validated CLEAN, so the key read exactly like it still worked while the
// AdSense account it was meant to leave alone started being managed. `units`
// was the other half of the same proposal and never shipped either.
test('the retired adsense gates bounce toward the one switch (#628)', () => {
  for (const key of ['enabled', 'units']) {
    const { errors } = validateConfig({
      ...VALID,
      advertising: { providers: { adsense: { client: 'ca-pub-1', [key]: false } } },
    });

    assert.ok(
      errors.some((e) => e.includes(`config.advertising.providers.adsense.${key} is retired`)
        && e.includes('advertising.providers.adsense')
        && e.includes('#527')),
      `adsense.${key} must bounce: ${errors.join(' | ')}`,
    );
  }
});

// #607 addendum (Ian 2026-08-26): a title never exists in two places. The
// config `meta` section shipped for one wave beside the page's own bare
// `meta:`, so a site default had two homes that could disagree. Title and
// description are GONE: page frontmatter is the only per-page meta, and the
// global default is brand.name / brand.description. A brand still carrying
// them must hear it. #564 narrowed the rows from the whole block to those two
// keys, because `meta.index` is LIVE at both levels now (below).
test('#607: config `meta.title` / `meta.description` are retired — page frontmatter is the only meta', () => {
  const { errors } = validateConfig({ ...VALID, meta: { title: 'Site default', description: 'Site desc' } });

  assert.ok(
    errors.some((e) => e.includes('config.meta.title is retired') && e.includes('brand.name')),
    `a config meta.title must bounce and name brand.name: ${errors.join(' | ')}`,
  );
  assert.ok(
    errors.some((e) => e.includes('config.meta.description is retired') && e.includes('brand.description')),
    `a config meta.description must bounce and name brand.description: ${errors.join(' | ')}`,
  );

  const web = validateConfig({ ...VALID, targets: { web: { meta: { title: 'Site default' } } } }, { target: 'web' });
  assert.ok(
    web.errors.some((e) => e.includes('meta.title is retired') && e.includes('brand.name')),
    `the targets.web overlay must bounce too: ${web.errors.join(' | ')}`,
  );

  // The analytics provider named `meta` keeps its name — the retirement is a
  // PATH, never the key name (retired-keys.js's header rule).
  assert.deepStrictEqual(
    validateConfig({ ...VALID, analytics: { providers: { meta: { id: '123' } } } }).errors,
    [],
  );
});

// #564 (Ian 2026-09-09, the same-name ruling): the site-wide index switch and
// the page override of it share ONE name. `seo.index` was the second spelling.
test('#564: `seo.index` is retired and points at targets.web.meta.index', () => {
  const { errors } = validateConfig({ ...VALID, seo: { index: false } });

  assert.ok(
    errors.some((e) => e.includes('config.seo.index is retired') && e.includes('targets.web.meta.index')),
    `seo.index must bounce naming its replacement: ${errors.join(' | ')}`,
  );

  // `seo` itself lives on — the manager's seo service reads github.content.
  assert.deepStrictEqual(
    validateConfig({ ...VALID, seo: { github: { content: [] } } }).errors,
    [],
  );
});

test('#564: `targets.web.meta.index` is LIVE, the site-wide default of the page flag', () => {
  // Authored shape: nothing in the block is retired any more.
  assert.deepStrictEqual(
    validateConfig({ ...VALID, targets: { web: { meta: { index: false } } } }, { target: 'web' }).errors,
    [],
    'the authored site default carries no retired key',
  );

  // Resolved shape: a target's keys land at the top level, which is where the
  // web schema rule reads them.
  assert.deepStrictEqual(
    validateConfig({ ...VALID, meta: { index: false } }, { target: 'web' }).errors,
    [],
    'the resolved site default validates clean',
  );

  const bad = validateConfig({ ...VALID, meta: { index: 'false' } }, { target: 'web' });
  assert.ok(
    bad.errors.some((e) => e.includes('meta.index') && e.includes('boolean')),
    `a non-boolean must bounce: ${bad.errors.join(' | ')}`,
  );
});

// #732 — the array (multi-instance) target form indexes positionally, so the
// walk's real keyPath is `targets.web.1.meta`. Every `targets.<type>.*` row
// missed that shape, which is the one a brand with two sites has.
test('#732: a retired path inside a multi-instance target instance bounces', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: {
      web: [
        { id: 'main' },
        { id: 'docs', meta: { title: 'Site default' }, redirects: [{ from: '/c/:id', to: '/code?id=:id' }] },
      ],
    },
  });

  // The REPORTED path keeps the index — that is where the author finds the key.
  assert.ok(
    errors.some((e) => e.includes('config.targets.web.1.meta.title is retired') && e.includes('brand.name')),
    `the instance's meta title must bounce at its real path: ${errors.join(' | ')}`,
  );
  assert.ok(
    errors.some((e) => e.includes('config.targets.web.1.redirects is retired')
      && e.includes('edge.providers.cloudflare.rules.redirect')),
    `the instance's redirect map must bounce too: ${errors.join(' | ')}`,
  );

  // An instance carrying nothing retired is still clean.
  assert.deepStrictEqual(
    validateConfig({ ...VALID, targets: { web: [{ id: 'main' }, { id: 'docs' }] } }).errors,
    [],
  );
});

// #588: brand.subdomains was read by the cloud hosting op and by nothing
// else. No schema rule, no default, never materialized. Ian's 2026-09-01 call
// made the web instance the home (the instance id IS the subdomain), so a
// brand still carrying the list must hear the recipe instead of validating
// clean while the hosting op quietly reconciles api.{sub}.{domain} domains.
test('#588: brand.subdomains is retired, since each subdomain is a web instance', () => {
  const { errors } = validateConfig({
    ...VALID,
    brand: { ...VALID.brand, subdomains: ['admin', 'cdn'] },
  });

  assert.ok(
    errors.some((e) => e.includes('config.brand.subdomains is retired')
      && e.includes('targets.web')
      && e.includes("{ id: 'admin' }")),
    `the subdomain list must bounce and carry the recipe: ${errors.join(' | ')}`,
  );

  // The replacement itself validates clean, and one api.<domain> serves them all
  assert.deepStrictEqual(
    validateConfig({ ...VALID, targets: { web: [{ id: 'main' }, { id: 'admin' }, { id: 'cdn' }] } }).errors,
    [],
  );
});

// H1: `subdomains` exists nowhere else in the schema, so it is a NAME test
// (retired-keys.js's #142 rule), walked at every depth. A brand that pushed the
// list down into an instance's own brand block must hear it on a whole-file
// load, which is the shape the manager walk validates.
test('#588: the subdomains list bounces at every depth, instance arrays included', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: { web: [{ id: 'main' }, { id: 'admin', brand: { subdomains: ['x'] } }] },
  });

  assert.ok(
    errors.some((e) => e.includes('config.targets.web.1.brand.subdomains is retired')
      && e.includes('targets.web')),
    `the nested list must bounce at its real path: ${errors.join(' | ')}`,
  );
});

// #788: the user-connection feature is `connections` now — the product concept
// is a connection, and a connection will not always be an OAuth grant (an API
// key or a bot token is one too), so each record names its kind with
// `type: 'oauth2'` instead. A brand still carrying the old section name would
// validate clean while every card and every provider credential went unread.
test('#788: the oauth2 section is retired, since the feature is connections now', () => {
  const { errors } = validateConfig({
    ...VALID,
    oauth2: { discord: { enabled: true, name: 'Discord', logo: 'https://cdn.test/discord.svg' } },
  });

  assert.ok(
    errors.some((e) => e.includes('config.oauth2 is retired') && e.includes('connections')),
    `the old section must bounce and name its replacement: ${errors.join(' | ')}`,
  );

  // The replacement itself validates clean, with the same free-form entry
  assert.deepStrictEqual(
    validateConfig({
      ...VALID,
      connections: { discord: { enabled: true, name: 'Discord', logo: 'https://cdn.test/discord.svg' } },
    }).errors,
    [],
  );
});

// A NAME test (retired-keys.js's #142 rule): `oauth2` exists nowhere else in
// the schema, so a brand that pushed the block down into a target override
// hears it on a whole-file load too.
test('#788: the oauth2 section bounces at every depth, target overrides included', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: { backend: { oauth2: { google: {} } } },
  });

  assert.ok(
    errors.some((e) => e.includes('config.targets.backend.oauth2 is retired') && e.includes('connections')),
    `the nested block must bounce at its real path: ${errors.join(' | ')}`,
  );
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

// ─── targets.backend.projectType (#584) ───

test('targets.backend.projectType takes firebase or custom, and nothing else', () => {
  assert.deepStrictEqual(validateConfig({ ...VALID, projectType: 'firebase' }, { target: 'backend' }).errors, []);
  assert.deepStrictEqual(validateConfig({ ...VALID, projectType: 'custom' }, { target: 'backend' }).errors, []);
  assert.deepStrictEqual(validateConfig(VALID, { target: 'backend' }).errors, [], 'absence is the firebase default');

  const wrong = validateConfig({ ...VALID, projectType: 'render' }, { target: 'backend' });
  assert.ok(
    wrong.errors.some((e) => e.includes('config.projectType') && e.includes('custom')),
    `an unknown project type must be loud and name the options: ${wrong.errors.join(' | ')}`,
  );
});


// ─── undeclared paths (#636) ───

// The validator only ever checked the paths the schema DECLARES, so a key the
// schema had never heard of — a typo, or a live path nobody declared (the whole
// `certificates` section was one) — passed in silence. It is a WARNING, never
// an error: a brand's config outliving one framework version must not fail its
// build, and the point is to surface the gap.
test('an undeclared leaf warns once, naming the path', () => {
  const { warnings, errors } = validateConfig({ ...VALID, brand: { ...VALID.brand, nickname: 'sandy' } });

  assert.deepStrictEqual(errors, [], 'an unknown key never fails the config');
  assert.equal(warnings.length, 1, `exactly one warning: ${warnings.join(' | ')}`);
  assert.ok(warnings[0].includes('brand.nickname'), `the warning names the path: ${warnings[0]}`);
  assert.ok(warnings[0].includes('schema.js'), 'the warning says where a real key gets declared');
});

test('a fully declared config warns about nothing', () => {
  const declared = {
    ...VALID,
    theme: { id: 'classy', appearance: 'system' },
    captcha: { providers: { recaptcha: { siteKey: '6Lc-key', domainsConfirmed: ['brand.test'] } } },
    certificates: { enabled: true, providers: { apple: { bundleIdPrefix: 'com.acme' } } },
    domain: { providers: { namecheap: {} } },
    advertising: { fallback: 'inhouse', tags: ['news'] },
  };

  assert.deepStrictEqual(validateConfig(declared).warnings, []);
});

test('a declared object/array rule covers everything beneath it', () => {
  // brand.address is declared as an object — its fields are the brand's own
  // postal shape, not schema paths, and an empty section a schema declares
  // BELOW is not an undeclared leaf either.
  const { warnings } = validateConfig({
    ...VALID,
    brand: { ...VALID.brand, address: { line1: '1 Main St', city: 'Springfield' } },
    certificates: {},
  });

  assert.deepStrictEqual(warnings, []);
});

test('a target entry\'s own keys are never undeclared — that namespace is the targets check\'s', () => {
  const { warnings } = validateConfig({
    ...VALID,
    targets: { web: { whateverThePageWants: true }, api: { type: 'custom', port: 8080 } },
  });

  assert.deepStrictEqual(warnings, [], 'targets.<name>.* is open by design (custom targets, per-framework keys)');
});

// The point of the check: run it against every brand in this repo. A path a
// brand actually uses and the schema does not declare is a hole to fill, not a
// warning to live with — #636 filled the ones this found.
test('the in-repo brands carry no undeclared paths', () => {
  const path = require('node:path');
  const { loadConfig } = require('../src/load.js');

  for (const brand of ['naked-brand', 'sandbox-brand', 'omega-playground', 'newsflash-brand']) {
    const { warnings } = loadConfig(path.join(__dirname, '..', '..', '..', 'brands', brand));

    assert.deepStrictEqual(warnings, [], `${brand}: ${warnings.join(' | ')}`);
  }
});

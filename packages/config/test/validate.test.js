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
  AMO_CATEGORIES,
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
  // (docs/backend/email-system.md → "Identity is config, or it is an error").
  const configured = validateConfig({
    ...VALID,
    brand: {
      ...VALID.brand,
      contact: {
        email: 'hello@sandbox.example',
        person: { name: 'Jane Doe, CEO', firstName: 'Jane', image: 'https://x.com/j.jpg', url: 'https://jane.example', urlText: '@jane' },
        carbonCopy: [{ email: 'audit@sandbox.example', name: 'Audit' }],
      },
      images: { wordmark: 'https://x.com/wordmark.png' },
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

test('parent is not a key, and its last meaning is company.webhooks (#677)', () => {
  // Every shape of it fails like any unknown key: the loader knows no old
  // name, and `omega migrate` is what names the new home.
  for (const value of [false, 'self', 'https://api.example.com', true]) {
    const { errors } = validateConfig({ ...VALID, parent: value });
    assert.ok(errors.some((e) => e.startsWith('config.parent is not a key the schema declares') && e.includes('npx omega migrate')), `parent: ${value} fails the load`);
    assert.ok(!errors.some((e) => e.includes('company.webhooks')), 'the loader carries no legacy knowledge');
  }

  // The successor: a typed boolean inside the company block, default true.
  assert.deepStrictEqual(validateConfig({ ...VALID, company: { id: 'itw-creative-works', webhooks: false } }).errors, []);
  assert.ok(validateConfig({ ...VALID, company: { id: 'itw-creative-works', webhooks: 'no' } }).errors
    .some((e) => e.includes('config.company.webhooks has wrong type')));
});

test('company: the id is the one typed key, and the rest is resolved (#677)', () => {
  assert.deepStrictEqual(validateConfig({ ...VALID, company: { id: 'itw-creative-works' } }).errors, []);
  assert.deepStrictEqual(validateConfig({ ...VALID, company: { id: 'self' } }).errors, []);

  const { errors } = validateConfig({ ...VALID, company: { id: 42 } });
  assert.ok(errors.some((e) => e.includes('config.company.id has wrong type')));
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
      translation: { enabled: true, default: 'en', languages: ['es', 'fr'], providers: { claude: {} }, include: ['**', '!blog/**'] },
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
    targets: { web: { type: 'web' } },
    repo: { org: 'itw-creative-works' },
    reviews: { enabled: true, sites: ['trustpilot.com'] },
    marketing: { campaigns: { enabled: true, providers: { sendgrid: { listId: 'lst_1' } } }, prune: { enabled: true } },
    blog: { enabled: false },
    dataRequest: { queries: [] },
  };

  assert.deepStrictEqual(validateConfig(websiteOnly).errors, []);
  assert.deepStrictEqual(validateConfig(websiteOnly, { target: 'web' }).errors, []);

  // Shared keys are TYPED shared too: no backend target needed to catch a shape mistake.
  const { errors } = validateConfig({ ...VALID, repo: 'itw', reviews: 'yes', marketing: [1], blog: 'on', dataRequest: 3 });
  assert.ok(errors.some((e) => e.includes('config.repo has wrong type')));
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
    targets: { web: { type: 'web' } },
    company: { id: 'itw-creative-works' },
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

test('an unrecognized top-level key is an error: the six manager sections are NAMED keys (#277)', () => {
  assert.deepStrictEqual(
    validateConfig({ ...VALID, bogusSection: { a: 1 } }).errors,
    ['config.bogusSection.a is not a key the schema declares. Remove it, or if it is a legacy key run `npx omega migrate` at the brand root (report) and `--execute` to convert (docs/shared/config.md → Validation)'],
  );

  // A secret-shaped key still bounces as a secret alongside a bogus one
  const { errors } = validateConfig({
    ...VALID,
    bogusSection: { a: 1 },
    payment: { providers: { stripe: { apiSecret: 'x' } } },
  });
  assert.ok(errors.some((e) => e.includes('config.payment.providers.stripe.apiSecret looks like a secret')));
});

// ─── validateConfig: targets sanity ───

test('#886: every entry declares a type, and the KEY is only a name', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: {
      web: { type: 'web' },
      untyped: {},
      admin: { type: 'website' },
      backend: true,
    },
  });

  assert.ok(errors.some((e) => e.includes('config.targets.untyped must declare `type`')));
  assert.ok(errors.some((e) => e.includes('config.targets.admin must declare `type`') && e.includes('"website"')));
  assert.ok(errors.some((e) => e.includes('config.targets.backend must be an object declaring its type')));
  assert.strictEqual(errors.length, 3);
});

test('#886: the retired instance ARRAY names its replacement, a sibling key', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: { web: [{ id: 'main' }, { id: 'admin' }] },
  });

  assert.ok(
    errors.some((e) => e.includes('config.targets.web is an array')
      && e.includes('sibling key')
      && e.includes('docs/shared/breaking-changes.md 2026-09-11')),
    `the array form must bounce with the migration pointer: ${errors.join(' | ')}`,
  );
});

test('#886: a key that is not a dir-safe slug is an error, since the name IS the folder', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: { 'Admin Console': { type: 'web' } },
  });

  assert.ok(errors.some((e) => e.includes('config.targets.Admin Console is not a usable target name')));
  assert.strictEqual(errors.length, 1);
});

test('#886: any NAME is legal when its type is, so targets/website is a brand\'s own choice', () => {
  assert.deepStrictEqual(
    validateConfig({ ...VALID, targets: { website: { type: 'web' }, community: { type: 'web' }, api: { type: 'custom' } } }).errors,
    [],
  );
});

test('all canonical types are accepted (mobile stays reserved but valid)', () => {
  const targets = Object.fromEntries(TARGETS.map((t) => [t, { type: t }]));

  assert.deepStrictEqual(validateConfig({ ...VALID, targets }).errors, []);
});

test('#886: more than one backend target is a WARNING, never an error', () => {
  const multi = validateConfig({ ...VALID, targets: { backend: { type: 'backend' }, eu: { type: 'backend' } } });

  assert.deepStrictEqual(multi.errors, []);
  assert.ok(multi.warnings.some((w) => w.includes('2 backend targets') && w.includes('unsupported')));

  const single = validateConfig({ ...VALID, targets: { backend: { type: 'backend' } } });
  assert.deepStrictEqual(single.errors, []);
  assert.deepStrictEqual(single.warnings, []);
});

// ─── validateConfig: per-target refinements ───

test('target refinements only apply with options.target', () => {
  const config = { ...VALID, startup: { mode: 'invisible' } };

  // Shared-only, a desktop key is just a key nobody declared
  assert.deepStrictEqual(validateConfig(config).errors.map((e) => e.split(' ')[0]), ['config.startup.mode']);

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
  const gated = { ...VALID, releases: { enabled: false } };
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

test('extension listing IDS are declared keys beside the url, one home for the store identifier (#893)', () => {
  // A store item id is public by design (it is IN the listing URL), so it lives
  // in config beside the url it belongs to, never in .env, which holds secrets.
  const identified = {
    ...VALID,
    listings: {
      chrome: { id: 'abcdefghijklmnopabcdefghijklmnop', url: 'https://chromewebstore.google.com/detail/x' },
      firefox: { id: 'extension@acme.com' },
      edge: { id: '11111111-2222-3333-4444-555555555555' },
    },
  };
  assert.deepStrictEqual(validateConfig(identified, { target: 'extension' }).errors, []);

  const { errors } = validateConfig(
    { ...VALID, listings: { chrome: { id: 12345 } } },
    { target: 'extension' },
  );
  assert.ok(errors.some((e) => e.includes('config.listings.chrome.id has wrong type')));
});

test('extension categories are AMO slugs: the live list passes, anything else names the list (#884)', () => {
  // The first Firefox publish sends these to addons.mozilla.org verbatim, so a
  // slug AMO does not know is a submission that fails at the store instead of
  // in the build. Every live slug validates, because the list IS the schema's.
  assert.deepStrictEqual(
    validateConfig({ ...VALID, categories: AMO_CATEGORIES }, { target: 'extension' }).errors,
    [],
  );

  const { errors } = validateConfig(
    { ...VALID, categories: ['alerts-updates', 'productivity'] },
    { target: 'extension' },
  );
  assert.ok(errors.some((e) => e.includes('config.categories') && e.includes('"productivity"') && e.includes('alerts-updates')));

  const typed = validateConfig({ ...VALID, categories: 'alerts-updates' }, { target: 'extension' });
  assert.ok(typed.errors.some((e) => e.includes('config.categories has wrong type')));
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

test('#564: `targets.web.meta.index` is LIVE, the site-wide default of the page flag', () => {
  // Authored shape: nothing in the block is retired any more.
  assert.deepStrictEqual(
    validateConfig({ ...VALID, targets: { web: { type: 'web', meta: { index: false } } } }, { target: 'web' }).errors,
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

// ─── one repo block, one hosting key (#883) ───────────────────────────────

// `repo: { provider, org }` is the whole declaration, and the org is the owner
// of every repo the brand's names derive under. A block with no org would let
// every derivation answer null and every reader skip in its own quiet way.
test('#883: the repo block is provider + org, and the org is required when the block is there', () => {
  assert.deepStrictEqual(validateConfig({ ...VALID, repo: { org: 'Acme-Org' } }).errors, []);
  assert.deepStrictEqual(validateConfig({ ...VALID, repo: { provider: 'github', org: 'Acme-Org' } }).errors, []);

  const { errors } = validateConfig({ ...VALID, repo: { provider: 'github' } });
  assert.ok(
    errors.some((e) => e.includes('config.repo.org is required when the repo block is present')),
    `an org-less block must bounce: ${errors.join(' | ')}`,
  );

  assert.ok(
    validateConfig({ ...VALID, repo: { org: '   ' } }).errors
      .some((e) => e.includes('config.repo.org is required')),
    'whitespace is not an org',
  );
});

test('#883: repo.provider names a host OMEGA builds for', () => {
  const { errors } = validateConfig({ ...VALID, repo: { provider: 'gitlab', org: 'Acme-Org' } });

  assert.ok(
    errors.some((e) => e.includes('config.repo.provider "gitlab" is not a host OMEGA builds for')
      && e.includes('github')),
    `an unbuilt provider must bounce and name the table: ${errors.join(' | ')}`,
  );
});

// Only a web target has a built site to serve, so `hosting` anywhere else is a
// statement nothing reads: the deploy would publish nothing and the manage walk
// would create no repo for it.
test('#883: hosting is a WEB target key, and its provider is table-checked', () => {
  assert.deepStrictEqual(
    validateConfig({
      ...VALID,
      repo: { org: 'Acme-Org' },
      targets: { web: { type: 'web', hosting: { provider: 'github' } }, community: { type: 'web' } },
    }).errors,
    [],
  );

  const wrongTarget = validateConfig({
    ...VALID,
    targets: { web: { type: 'web' }, desktop: { type: 'desktop', hosting: { provider: 'github' } } },
  });
  assert.ok(
    wrongTarget.errors.some((e) => e.includes('config.targets.desktop.hosting is a web-target key')),
    `hosting on a non-web target must bounce: ${wrongTarget.errors.join(' | ')}`,
  );

  const wrongProvider = validateConfig({
    ...VALID,
    targets: { web: { type: 'web', hosting: { provider: 'vercel' } } },
  });
  assert.ok(
    wrongProvider.errors.some((e) => e.includes('config.targets.web.hosting.provider "vercel" is not a host OMEGA builds for')),
    `an unbuilt hosting provider must bounce: ${wrongProvider.errors.join(' | ')}`,
  );
});

// `releases: {}` stays the presence switch for the site's download links: only
// the owner/repo override left with #883.
test('#883: a bare releases block still validates, with no repo to name', () => {
  assert.deepStrictEqual(
    validateConfig({
      ...VALID,
      repo: { org: 'Acme-Org' },
      targets: { web: { type: 'web' }, desktop: { type: 'desktop', releases: {} } },
    }).errors,
    [],
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
    repo: { org: 'Acme-Org' },
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


// ─── the schema is STRICT: an undeclared path fails the load ───

const UNDECLARED = 'is not a key the schema declares. Remove it, or if it is a legacy key run `npx omega migrate` at the brand root (report) and `--execute` to convert (docs/shared/config.md → Validation)';

test('an undeclared leaf is an error naming the path and omega migrate', () => {
  const { warnings, errors } = validateConfig({ ...VALID, brand: { ...VALID.brand, nickname: 'sandy' } });

  assert.deepStrictEqual(errors, [`config.brand.nickname ${UNDECLARED}`]);
  assert.deepStrictEqual(warnings, [], 'never a warning: the load fails');
});

test('one error line per undeclared path, so a brand sees each key', () => {
  const { errors } = validateConfig({ ...VALID, brand: { ...VALID.brand, nickname: 'sandy' }, extras: { a: 1, b: [2] } });

  assert.deepStrictEqual(errors, [
    `config.brand.nickname ${UNDECLARED}`,
    `config.extras.a ${UNDECLARED}`,
    `config.extras.b ${UNDECLARED}`,
  ]);
});

test('a retired name fails exactly like any unknown key, with no special message', () => {
  const { errors } = validateConfig({ ...VALID, slapform: { endpoint: 'https://slapform.test/f/abc' }, translation: { exclude: ['docs'] } });

  assert.deepStrictEqual(errors, [
    `config.slapform.endpoint ${UNDECLARED}`,
    `config.translation.exclude ${UNDECLARED}`,
  ]);
});

test('a retired key inside a target entry fails its PER-TARGET load, hoisted to the top level', () => {
  const config = { ...VALID, targets: { web: { type: 'web', download: { mac: 'https://acme.test/mac.dmg' } } } };

  // The whole-file walk leaves the targets namespace to the targets check…
  assert.deepStrictEqual(validateConfig(config).errors, []);

  // …and the target's own load sees the key where its framework would read it
  const { errors } = validateConfig({ ...VALID, download: { mac: 'https://acme.test/mac.dmg' } }, { target: 'web' });
  assert.deepStrictEqual(errors, [`config.download.mac ${UNDECLARED}`]);
});

test('a fully declared config fails nothing', () => {
  const declared = {
    ...VALID,
    theme: { id: 'classy', appearance: 'system' },
    captcha: { providers: { recaptcha: { siteKey: '6Lc-key', domainsConfirmed: ['brand.test'] } } },
    certificates: { enabled: true, providers: { apple: { bundleIdPrefix: 'com.acme' } } },
    domain: { providers: { namecheap: {} } },
    advertising: { fallback: 'inhouse', tags: ['news'] },
  };

  assert.deepStrictEqual(validateConfig(declared), { errors: [], warnings: [] });
});

test('a declared object/array rule keeps its subtree open', () => {
  // brand.address is the brand's own postal shape, connections an open
  // provider map, and an empty section a schema declares BELOW is no leaf.
  const { errors } = validateConfig({
    ...VALID,
    brand: { ...VALID.brand, address: { line1: '1 Main St', city: 'Springfield' } },
    connections: { acme: { enabled: true, scope: ['read'] } },
    certificates: {},
  });

  assert.deepStrictEqual(errors, []);
});

test('the whole-file walk leaves a target entry\'s own keys to the targets check', () => {
  const { errors } = validateConfig({
    ...VALID,
    targets: { web: { type: 'web', whateverThePageWants: true }, api: { type: 'custom', port: 8080 } },
  });

  assert.deepStrictEqual(errors, [], 'targets.<name>.* is judged by that target\'s own load, and a custom target\'s keys are its own');
});

// The documented desktop escape hatches: build-config and the runtime read
// each one off the resolved desktop config, so strictness must keep them open.
test('the desktop escape hatches pass a desktop load: electronBuilder, windows, cdp, fileAssociations, protocols', () => {
  const config = {
    ...VALID,
    electronBuilder: { mac: { hardenedRuntime: true }, extraResources: ['assets/**'] },
    windows: { main: { width: 1200, titleBarOverlay: { color: '#000' } } },
    cdp: { readySignal: 'overlay' },
    fileAssociations: [{ ext: 'acme', name: 'Acme File' }],
    protocols: [{ name: 'Acme', schemes: ['acme'] }],
  };

  assert.deepStrictEqual(validateConfig(config, { target: 'desktop' }).errors, []);

  const wrong = validateConfig({ ...VALID, electronBuilder: 'yes', fileAssociations: { ext: 'acme' } }, { target: 'desktop' }).errors;
  assert.ok(wrong.some((e) => e.includes('config.electronBuilder has wrong type')), wrong.join(' | '));
  assert.ok(wrong.some((e) => e.includes('config.fileAssociations has wrong type')), wrong.join(' | '));
});

// The manager's own switches and engine data: documented, brand-overridable,
// and written back by its services, so each one owes a rule.
test('the manager-read keys pass: the brand switch, the service switches, stripe and GA4 engine data', () => {
  const config = {
    ...VALID,
    enabled: false,
    server: { enabled: false },
    assets: { enabled: false },
    payment: {
      enabled: false,
      providers: { stripe: { updateAccountInfo: false, radar: [{ action: 'block', predicate: ':risk_level: = \'highest\'' }], radarConfirmed: true, disputesConfirmed: true } },
    },
    analytics: { providers: { google: { timeZone: 'America/Los_Angeles', currency: 'USD', enhancedMeasurement: { scrollsEnabled: false } } } },
  };

  assert.deepStrictEqual(validateConfig(config).errors, []);
  assert.deepStrictEqual(validateConfig({ ...VALID, server: false, assets: false }).errors, [], 'the section-level off switch too');
});

// Keys the framework writes onto a RESOLVED config, never a brand: the company
// the loader fills and the build facts a surface bakes. A decorated config
// re-validated at boot (the desktop main process) must pass.
test('the loader-filled company and the baked build facts pass a DECORATED re-validation', () => {
  const resolved = {
    ...VALID,
    company: { id: null, name: 'Sandbox Brand', url: 'https://sandbox.test', images: {} },
    runtime: 'electron',
    environment: 'production',
    version: '1.2.3',
    buildTime: 1700000000000,
    target: 'desktop',
    url: 'https://sandbox.test',
    dev: null,
  };

  assert.deepStrictEqual(validateConfig(resolved, { target: 'desktop', decorated: true }).errors, []);

  // An authored load declares no build fact: a brand typing one is refused
  const authored = validateConfig(resolved, { target: 'desktop' }).errors.map((e) => e.split(' ')[0]);
  assert.deepStrictEqual(authored, ['config.runtime', 'config.environment', 'config.version', 'config.buildTime', 'config.target', 'config.dev']);
});

test('a typo under a web dev key fails by default: `dev` is no open build fact on an authored load', () => {
  const { errors } = validateConfig({ ...VALID, dev: { limitCollectionz: 5 } }, { target: 'web' });

  assert.deepStrictEqual(errors, [`config.dev.limitCollectionz ${UNDECLARED}`]);
});

// A section with typed keys is CLOSED: only a rule with nothing declared
// beneath it (or `open: true`) opens its subtree.
test('a retired path or a typo inside a container section fails the load', () => {
  const cases = [
    [{ devlog: { enabeld: true } }, undefined, 'devlog.enabeld'],
    [{ devlog: { enabled: true, lookbackDays: 3 } }, undefined, 'devlog.lookbackDays'],
    [{ marketing: { campaigns: { provider: 'sendgrid' } } }, undefined, 'marketing.campaigns.provider'],
    [{ blog: { provider: 'ghostii' } }, undefined, 'blog.provider'],
    [{ seo: { index: false } }, undefined, 'seo.index'],
    [{ repo: { org: 'Acme-Org', providers: { github: { org: 'Acme-Org' } } } }, undefined, 'repo.providers.github.org'],
    [{ meta: { title: 'Site' } }, 'web', 'meta.title'],
    [{ platforms: { win: { arch: ['x64'] } } }, 'desktop', 'platforms.win.arch'],
    [{ platforms: { linux: { snap: { enabled: true } } } }, 'desktop', 'platforms.linux.snap.enabled'],
    [{ releases: { owner: 'Acme-Org', repo: 'acme-bins' } }, 'desktop', 'releases.owner'],
  ];

  for (const [config, target, path] of cases) {
    const { errors } = validateConfig({ ...VALID, ...config }, { target });
    assert.ok(errors.includes(`config.${path} ${UNDECLARED}`), `${path} must fail: ${errors.join(' | ')}`);
  }

  // The open bags stay open: the client settings bag and the cloudflare engine data
  assert.deepStrictEqual(
    validateConfig({ ...VALID, client: { auth: { enabled: true } }, edge: { providers: { cloudflare: { settings: { ssl: 'full' } } } } }).errors,
    [],
  );
});

// The drift guard: a framework's ANNOTATED DEFAULT is the checklist of what
// its runtime reads, so it must declare itself completely.
test('the desktop annotated default carries no undeclared paths (#911)', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { loadConfig } = require('../src/load.js');

  // Every load records its brand in the machine registry, and a framework's
  // default file is no brand of this machine: point the home at a temp dir.
  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-config-home-'));

  try {
    const defaults = path.join(__dirname, '..', '..', 'desktop', 'src', 'defaults');
    const { errors, warnings } = loadConfig(defaults, 'desktop');

    assert.deepStrictEqual(errors, [], errors.join(' | '));
    assert.deepStrictEqual(warnings, [], warnings.join(' | '));
  } finally {
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  }
});

// Every in-repo brand loads clean, whole-file AND through each target's own
// load, which hoists targets.<name>.* to the top level where strictness sees it.
test('the in-repo brands load with zero errors, whole-file and per target', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { loadConfig } = require('../src/load.js');

  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-config-home-'));

  try {
    for (const brand of ['naked-brand', 'sandbox-brand', 'playground-omega', 'newsflash-brand']) {
      const root = path.join(__dirname, '..', '..', '..', 'brands', brand);
      const whole = loadConfig(root);
      assert.deepStrictEqual(whole.errors, [], `${brand}: ${whole.errors.join(' | ')}`);

      for (const [name, entry] of Object.entries(whole.config.targets || {})) {
        if (!TARGETS.includes(entry.type) || entry.type === 'mobile') continue;

        const dir = fs.existsSync(path.join(root, 'targets', name)) ? path.join(root, 'targets', name) : root;
        const { errors } = loadConfig(dir, entry.type);
        assert.deepStrictEqual(errors, [], `${brand} targets.${name}: ${errors.join(' | ')}`);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  }
});

// The ONE authored-file walk the migrate pass and the web converter share
test('undeclaredAuthoredPaths: the whole file, then each framework target as its own load sees it', () => {
  const { undeclaredAuthoredPaths } = require('../src/index.js');
  const file = {
    ...VALID,
    bogus: 1,
    targets: { web: { type: 'web', meta: { index: false }, nope: true }, api: { type: 'custom', port: 8080 }, odd: { type: 'website', x: 1 } },
  };

  assert.deepStrictEqual(undeclaredAuthoredPaths(file), ['bogus', 'targets.web.nope']);

  // A target's own file: its top level is that target's layer
  assert.deepStrictEqual(undeclaredAuthoredPaths({ meta: { index: false }, nope: true }, { target: 'web' }), ['nope']);
  assert.deepStrictEqual(undeclaredAuthoredPaths({ meta: { index: false } }), ['meta.index']);
});

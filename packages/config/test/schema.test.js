/**
 * Unit tests for @omega.js/config's schema module — the declared shared
 * sections and the schema paths other packages read.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SHARED_SECTIONS, BACKEND_PROJECT_TYPES, backendProjectType } = require('../src/index.js');

test('SHARED_SECTIONS enumerates the disperse-owned sections', () => {
  assert.deepStrictEqual(
    SHARED_SECTIONS,
    ['brand', 'cloud', 'repo', 'edge', 'captcha', 'search', 'forms', 'inbound', 'analytics', 'advertising', 'features', 'payment', 'monitoring', 'connections', 'theme', 'translation'],
  );
});

test('SHARED_SECTIONS carries the #23 role homes — disperse enumerates them like any other shared section', () => {
  for (const section of ['repo', 'edge', 'captcha', 'search', 'forms', 'inbound']) {
    assert.ok(SHARED_SECTIONS.includes(section), `${section} is a shared section and must be enumerated`);
  }
});

test('advertising schema: role-keyed providers with the inhouse source (ads spec)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const paths = SHARED_SCHEMA.map((entry) => entry.path);

  assert.ok(paths.includes('advertising.providers.adsense.client'));
  assert.ok(paths.includes('advertising.providers.inhouse.source'));
  assert.ok(paths.includes('company.url'));
  for (const slot of ['displaySlot', 'inArticleSlot', 'inFeedSlot', 'multiplexSlot']) {
    assert.ok(paths.includes(`advertising.providers.adsense.${slot}`), `missing ${slot}`);
  }

  // The vendor prefix and the kebab spellings are gone for good (#23/#35)
  assert.ok(!paths.some((path) => path.includes('google-adsense')), 'no vendor-prefixed provider id survives');
  assert.ok(!paths.some((path) => /^advertising\..*-/.test(path)), 'no kebab-case key survives under advertising');
});

// #527 — adsense is case 1 of the gating doctrine (docs/shared/config.md):
// a DATA-bearing feature switches on its data's presence, one polarity and
// one switch. `client` set = the manager manages the account, the site
// renders units, ads.txt carries the record; `client` absent = all of it off.
// The split gates that once lived beside it (`units`, `enabled`) are deleted:
// a second switch is how a config says "managed but ad-free" to one half of
// the stack and "serve ads" to the other.
test('advertising: adsense is pure client-presence — no second switch (#527)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');
  const rule = SHARED_SCHEMA.find((entry) => entry.path === 'advertising.providers.adsense.client');

  assert.ok(rule, 'missing advertising.providers.adsense.client');
  assert.equal(rule.type, 'string');
  assert.equal(rule.required, false);
  assert.match(rule.description, /presence/i, 'the description names the polarity it drives');

  for (const gate of ['units', 'enabled']) {
    assert.equal(
      SHARED_SCHEMA.find((entry) => entry.path === `advertising.providers.adsense.${gate}`), undefined,
      `advertising.providers.adsense.${gate} is deleted — client presence decides everything`,
    );
  }

  // `advertising` stays presence-gated end to end: no adsense rule carries a
  // materialized default, so no brand grows an advertising block (the build's
  // automatic vert placements key on `site.advertising` existing at all).
  for (const adsenseRule of SHARED_SCHEMA.filter((entry) => entry.path.startsWith('advertising.'))) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(adsenseRule, 'default'), false,
      `${adsenseRule.path} materializes an advertising block into every brand`,
    );
  }
  assert.equal(require('../src/defaults.js').schemaDefaults('web').advertising, undefined, 'no brand grows an advertising block');

  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  assert.deepEqual(
    validateConfig({ ...base, advertising: { providers: { adsense: { client: 'ca-pub-1' } } } }).errors, [],
    'the one expressible ON state is a client id',
  );
});

// #642 — the crypto provider is back as a real one, so its config switch owes
// the schema a rule like every other. Coinbase Commerce's ONLY credential is a
// secret (COINBASE_COMMERCE_API_KEY), and a secret can never live in config, so
// there is no case-1 datum to gate on: the switch is an explicit `enabled`,
// default OFF. Default OFF because an accidental ON puts a Crypto button on the
// checkout that no key can complete.
test('payment: coinbase is an explicit enabled switch, default OFF (#642)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');

  const rule = SHARED_SCHEMA.find((entry) => entry.path === 'payment.providers.coinbase.enabled');

  assert.ok(rule, 'missing payment.providers.coinbase.enabled');
  assert.equal(rule.type, 'boolean');
  assert.equal(rule.required, false);
  assert.equal(rule.default, false, 'the polarity is stated by the default');

  // The sibling providers keep their own (case-1) data switches
  const paths = SHARED_SCHEMA.map((entry) => entry.path);
  for (const path of ['payment.providers.stripe.publishableKey', 'payment.providers.paypal.clientId', 'payment.providers.chargebee.site']) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }

  // A brand carrying the block validates clean — it stopped doing so when #636
  // deleted the stub out from under every config that had one
  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  assert.deepEqual(
    validateConfig({ ...base, payment: { providers: { coinbase: { enabled: true } } } }).errors, [],
    'an enabled crypto provider is expressible',
  );
});

test('monitoring declares every knob the monitoring package resolves (#380)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const paths = SHARED_SCHEMA.map((entry) => entry.path);

  // Undeclared keys pass validation silently, so a typo (scrubemail) would
  // vanish instead of failing — every documented knob is declared here. The
  // knobs hang off the PROVIDER since #425; only `enabled` is role-level.
  assert.ok(paths.includes('monitoring.enabled'), 'missing monitoring.enabled');
  for (const key of ['org', 'dsn', 'environment', 'sampleRate', 'tracesSampleRate', 'scrubEmail', 'attachScreenshot', 'bundlePatterns',
    'replaysSessionSampleRate', 'replaysOnErrorSampleRate']) {
    assert.ok(paths.includes(`monitoring.providers.sentry.${key}`), `missing monitoring.providers.sentry.${key}`);
  }
});

test('the de-branded role sections are declared (#23)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const paths = SHARED_SCHEMA.map((entry) => entry.path);

  const declared = [
    'forms.providers.slapform.formId',
    'inbound.chat.providers.chatsy.agentId',
    'inbound.chat.providers.chatsy.settings',
    'inbound.email.providers.replyify.agentId',
    'edge.providers.cloudflare',
    'edge.providers.cloudflare.zone',
    'captcha.providers.recaptcha.siteKey',
    'search.providers.searchConsole.submitSitemap',
    'repo.providers.github.org',
    // the gcp/firebase fold — one cloud home, projectId only under cloud.config
    'cloud.organizationId',
    'cloud.billingAccount',
    'cloud.shared',
    'cloud.supportEmail',
    'cloud.apiSubdomain',
  ];
  for (const path of declared) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }

  assert.ok(!paths.includes('cloud.projectId'), 'projectId has ONE home: cloud.config.projectId');
  // Every config key is camelCase — no hyphen survives anywhere in the schema
  assert.ok(!paths.some((path) => path.includes('-')), 'no hyphenated config key survives');
});

// #466 — the web target owns no redirect map any more: a templated redirect is
// a Cloudflare redirect RULE the edge service reconciles, and an enumerable one
// is a redirect PAGE. The rules block is where the retired key now points, so
// it owes the schema a rule of its own.
test('edge.providers.cloudflare.rules.redirect is declared — the templated-redirect home (#466)', () => {
  const { SHARED_SCHEMA, TARGET_SCHEMAS } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');

  assert.ok(
    !TARGET_SCHEMAS.web.some((entry) => entry.path === 'redirects'),
    'targets.web.redirects is gone — the web build answers no redirect config',
  );

  const rule = SHARED_SCHEMA.find((entry) => entry.path === 'edge.providers.cloudflare.rules.redirect');
  assert.ok(rule, 'missing edge.providers.cloudflare.rules.redirect');
  assert.equal(rule.type, 'array');
  assert.match(rule.description, /targetUrl/, 'the description names the destination key');

  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  assert.deepEqual(
    validateConfig({
      ...base,
      edge: {
        providers: {
          cloudflare: {
            rules: {
              redirect: [{
                name: 'Redirect: QR short code',
                expression: '(starts_with(http.request.uri.path, "/c/"))',
                statusCode: 301,
                preserveQueryString: false,
                targetUrl: { expression: 'concat("https://", http.host, "/code?id=", substring(http.request.uri.path, 3))' },
                enabled: true,
              }],
            },
          },
        },
      },
    }).errors,
    [],
    'the DashQR pattern passes as a rules entry',
  );
  assert.equal(
    validateConfig({ ...base, edge: { providers: { cloudflare: { rules: { redirect: { '/c/:id': '/code' } } } } } }).errors.length, 1,
    'a map is not a rules list — Cloudflare evaluates them in order',
  );
});

// #524 — every key a real brand config carries owes the schema a rule, the
// #272 precedent: an undeclared key validates only by not being looked at, so
// a typo in one of these reads as nothing and the validator cannot say what it
// means. Each one is carried by a converted brand or read by a service.
test('the carried keys brand configs already use are declared (#524)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');
  const rules = new Map(SHARED_SCHEMA.map((entry) => [entry.path, entry]));

  const expected = [
    ['brand.type', 'string'],
    ['brand.font', 'string'],
    ['brand.contact.phone', 'string'],
    ['cloud.oauthRedirectsConfigured', 'boolean'],
    ['analytics.providers.google.propertyId', 'string'],
    ['analytics.providers.google.accountId', 'string'],
    ['analytics.providers.meta.accountId', 'string'],
    ['analytics.providers.tiktok.accountId', 'string'],
    ['inbound.chat.providers.chatsy.accountId', 'string'],
  ];
  for (const [path, type] of expected) {
    assert.ok(rules.has(path), `missing ${path}`);
    assert.equal(rules.get(path).type, type, `${path} is a ${type}`);
    assert.ok(rules.get(path).description, `${path} documents what it drives`);
    assert.equal(rules.get(path).required, false, `${path} stays optional`);
  }

  // A rule is only worth having if it fails loudly on the wrong shape.
  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  assert.deepEqual(
    validateConfig({
      brand: { ...base.brand, type: 'Corporation', font: 'CromaSans-ExtraBold', contact: { phone: '+1-555-0100' } },
      cloud: { oauthRedirectsConfigured: true },
      analytics: { providers: { google: { propertyId: '222', accountId: '111' }, meta: { accountId: 'act_1' }, tiktok: { accountId: '7' } } },
      inbound: { chat: { providers: { chatsy: { accountId: 'uid-1' } } } },
    }).errors,
    [],
    'the shapes real brands carry pass',
  );
  assert.ok(
    validateConfig({ ...base, cloud: { oauthRedirectsConfigured: 'yes' } }).errors
      .some((e) => e.includes('config.cloud.oauthRedirectsConfigured has wrong type')),
    'the reconcile flag is a boolean, never a string',
  );
  assert.ok(
    validateConfig({ ...base, analytics: { providers: { google: { propertyId: 222 } } } }).errors
      .some((e) => e.includes('config.analytics.providers.google.propertyId has wrong type')),
    'a GA property id is the string the Admin API returns',
  );
});

test('socials is declared — the block @omega.js/web generates shortlink pages from (#429)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');
  const rule = SHARED_SCHEMA.find((entry) => entry.path === 'socials');

  // Undeclared keys pass validation silently, and this block now drives real
  // output (a redirect page per entry) — it has to be a declared object.
  assert.ok(rule, 'missing socials');
  assert.equal(rule.type, 'object');
  assert.match(rule.description, /redirect/, 'the description names the shortlink lane');

  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  assert.deepEqual(validateConfig({ ...base, socials: { twitter: 'somiibo' } }).errors, [], 'the string form is a handle');
  assert.deepEqual(
    validateConfig({ ...base, socials: { spotify: { handle: 'x', redirect: 'https://open.spotify.com/artist/x' } } }).errors, [],
    'the object form carries the handle plus its own redirect target',
  );
  assert.equal(validateConfig({ ...base, socials: ['twitter'] }).errors.length, 1, 'a list is not a socials block');
});

// #546 — three service switches the manager READS and the schema never
// declared: an undeclared key validates clean, so `enbaled: false` reads as ON
// forever and the validator cannot say what the real key does. All three are
// case 2 of the gating doctrine (docs/shared/config.md): a zero-data feature
// the framework runs for every brand, switched by `enabled`, default ON, read
// `!== false` at the service.
test('the service enabled switches the manager reads are declared, default ON (#546)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');
  const { schemaDefaults } = require('../src/defaults.js');
  const rules = new Map(SHARED_SCHEMA.map((entry) => [entry.path, entry]));

  const expected = [
    'repo.providers.github.enabled',
    'search.providers.searchConsole.enabled',
    'edge.providers.cloudflare.enabled',
  ];
  for (const path of expected) {
    assert.ok(rules.has(path), `missing ${path}`);
    assert.equal(rules.get(path).type, 'boolean', `${path} is a boolean`);
    assert.equal(rules.get(path).required, false, `${path} stays optional`);
    assert.equal(rules.get(path).default, true, `${path} defaults ON — the service runs unless told not to`);
    assert.ok(rules.get(path).description, `${path} documents what false skips`);
  }

  // The default is materialized, so a brand's own config carries the answer.
  const defaults = schemaDefaults('web');
  assert.equal(defaults.repo.providers.github.enabled, true);
  assert.equal(defaults.search.providers.searchConsole.enabled, true);
  assert.equal(defaults.edge.providers.cloudflare.enabled, true);

  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  assert.deepEqual(
    validateConfig({
      ...base,
      repo: { providers: { github: { enabled: false } } },
      search: { providers: { searchConsole: { enabled: false } } },
      edge: { providers: { cloudflare: { enabled: false } } },
    }).errors,
    [],
    'the OFF state every one of them honors is expressible',
  );
  assert.ok(
    validateConfig({ ...base, repo: { providers: { github: { enabled: 'no' } } } }).errors
      .some((e) => e.includes('config.repo.providers.github.enabled has wrong type')),
    'a truthy string would read as ON — the switch is a boolean',
  );
});

// #553 — the same hole one case over: the manager reads `devlog.enabled ===
// true` and the schema declared only the parent `devlog` object, so a typo
// validated clean and the validator could not say what the key does. Devlog is
// case 3 of the doctrine (docs/shared/config.md): it publishes AI-written posts
// to the brand's LIVE site, so the literal `true` is the only ON, absence is
// off, and NO default is materialized — writing a devlog block into every
// brand's omega.json5 is exactly the invitation a consequential feature must
// not extend.
test('devlog.enabled is declared — case 3, no materialized default (#553)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');
  const { schemaDefaults } = require('../src/defaults.js');
  const rule = SHARED_SCHEMA.find((entry) => entry.path === 'devlog.enabled');

  assert.ok(rule, 'missing devlog.enabled');
  assert.equal(rule.type, 'boolean', 'a truthy string must not read as ON');
  assert.equal(rule.required, false, 'a brand that never devlogs says nothing');
  assert.ok(!('default' in rule), 'no default — a materialized devlog block would put the switch in every brand\'s config');
  assert.match(rule.description, /publish/i, 'the description names what true turns on: published devlog posts');

  assert.equal(schemaDefaults('web').devlog, undefined, 'nothing devlog lands in the defaults layer');

  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  assert.deepEqual(validateConfig(base).errors, [], 'absence is valid — and means off');
  assert.deepEqual(
    validateConfig({ ...base, devlog: { enabled: true, providers: { ghostii: { orgs: ['x'] } } } }).errors, [],
    'the opt-in a brand actually writes still validates',
  );
  assert.ok(
    validateConfig({ ...base, devlog: { enabled: 'yes' } }).errors
      .some((e) => e.includes('config.devlog.enabled has wrong type')),
    'the switch is a boolean, so the near-miss is loud instead of ON',
  );
});

// #636 — the per-key sweep found live config paths the schema never declared:
// the certificates service reads the whole `certificates` block, the captcha
// and search services WRITE their confirmations back into the brand file, the
// domain service picks the registrar by the KEY under `domain.providers`, the
// TikTok mint reads the developer app id (#635), and the client's verts read
// the advertising fallback + tags. Undeclared means no type, no description,
// and no validator finding when one of them is misspelled.
test('the paths services read and write back are declared (#636)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const { schemaDefaults } = require('../src/defaults.js');
  const rules = new Map(SHARED_SCHEMA.map((entry) => [entry.path, entry]));

  const expected = {
    'certificates.enabled': 'boolean',
    'certificates.providers.apple.bundleIdPrefix': 'string',
    'certificates.providers.apple.capabilities': 'array',
    'certificates.providers.apple.profiles': 'array',
    'certificates.providers.apple.certificates': 'array',
    'captcha.providers.recaptcha.domainsConfirmed': 'array',
    'domain.providers.namecheap': 'object',
    'analytics.providers.tiktok.appId': 'string',
    'search.providers.searchConsole.gaLinked': 'boolean',
    'advertising.fallback': 'string|boolean',
    'advertising.tags': 'array',
  };

  for (const [path, type] of Object.entries(expected)) {
    const rule = rules.get(path);
    assert.ok(rule, `missing ${path}`);
    assert.equal(rule.type, type, `${path} declares its shape`);
    assert.equal(rule.required, false, `${path} is the brand's own answer, never demanded`);
    assert.ok(rule.description, `${path} documents what it drives`);
    // No materialized default: these are owner decisions (the Apple prefix, the
    // registrar) and machine-written confirmations. A default would write the
    // block into every brand's omega.json5 — a certificates block in a
    // website-only brand, a registrar in a brand that owns no domain.
    assert.ok(!('default' in rule), `${path} must not materialize a default`);
  }

  assert.equal(schemaDefaults('desktop').certificates, undefined, 'nothing certificates lands in the defaults layer');
  assert.equal(schemaDefaults('web').domain, undefined, 'nothing domain lands in the defaults layer');
});

// #649 — the seven SendGrid unsubscribe (ASM) group ids the backend's send path
// attaches. They were hardcoded in the backend, so a brand on any other SendGrid
// account sent with ids that do not exist there. The ids are per ACCOUNT: the
// campaigns service provisions each group by name and writes its id here.
test('the SendGrid unsubscribe group ids are declared, one row per group (#649)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');
  const { schemaDefaults } = require('../src/defaults.js');
  const rules = new Map(SHARED_SCHEMA.map((entry) => [entry.path, entry]));

  const keys = ['orders', 'hello', 'account', 'marketing', 'security', 'newsletter', 'internal'];

  for (const key of keys) {
    const path = `marketing.campaigns.providers.sendgrid.groups.${key}`;
    const rule = rules.get(path);
    assert.ok(rule, `missing ${path}`);
    assert.equal(rule.type, 'integer', `${path} is an ASM group id`);
    assert.equal(rule.required, false, `${path} is machine-written, never demanded`);
    assert.ok(rule.description, `${path} documents which email it gates`);
    // No materialized default: the id belongs to the brand's own SendGrid
    // account, so a written-in answer would be another account's group.
    assert.ok(!('default' in rule), `${path} must not materialize a default`);
  }

  assert.equal(schemaDefaults('backend').marketing?.campaigns?.providers?.sendgrid?.groups, undefined, 'no group ids land in the defaults layer');

  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  const groups = Object.fromEntries(keys.map((key, i) => [key, 100 + i]));
  assert.deepEqual(
    validateConfig({ ...base, marketing: { campaigns: { providers: { sendgrid: { groups } } } } }).errors,
    [],
    'the shape the campaigns service writes back validates clean',
  );
  assert.ok(
    validateConfig({ ...base, marketing: { campaigns: { providers: { sendgrid: { groups: { ...groups, orders: '16223' } } } } } }).errors
      .some((e) => e.includes('config.marketing.campaigns.providers.sendgrid.groups.orders has wrong type')),
    'a stringified id is caught — SendGrid answers ids as numbers',
  );
});

// #650 — three @omega.js/client keys that WORK (they reach the client payload
// and change behaviour: no auth policy, no exit popup, no service worker) and
// the schema never declared, so every validate run told a brand that turned
// one off it might be a typo. The client blob stays un-enumerated by design;
// these three are declared because a brand AUTHORS them.
test('the client keys a brand authors are declared (#650)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');
  const { schemaDefaults } = require('../src/defaults.js');
  const rules = new Map(SHARED_SCHEMA.map((entry) => [entry.path, entry]));

  for (const path of ['client.auth.config.policy', 'client.exitPopup.enabled', 'client.serviceWorker.enabled']) {
    assert.ok(rules.has(path), `missing ${path}`);
    assert.equal(rules.get(path).required, false, `${path} is the brand's own answer, never demanded`);
    assert.ok(rules.get(path).description, `${path} documents what it drives`);
  }

  // The two switches carry @omega.js/client's own polarity (both default ON),
  // so the answer is materialized into the brand file like consent's.
  const defaults = schemaDefaults('web');
  assert.equal(defaults.client.exitPopup.enabled, true);
  assert.equal(defaults.client.serviceWorker.enabled, true);
  // The policy is a PAGE decision (the auth layouts set it in frontmatter) and
  // its framework answer is "none" — nothing to write into a brand's config.
  assert.ok(!('default' in rules.get('client.auth.config.policy')), 'the policy must not materialize a default');

  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  const { errors, warnings } = validateConfig({
    ...base,
    client: {
      auth: { config: { policy: 'disabled' } },
      exitPopup: { enabled: false },
      serviceWorker: { enabled: false },
    },
  });

  assert.deepEqual(errors, [], 'the OFF state each of them honors is expressible');
  assert.deepEqual(warnings, [], 'and a brand that turns them off is not told it may have a typo');

  assert.ok(
    validateConfig({ ...base, client: { auth: { config: { policy: 'authed' } } } }).errors
      .some((e) => e.includes('config.client.auth.config.policy "authed" is not allowed')),
    'a near-miss policy is loud instead of silently no-policy',
  );
});

// ─── backendProjectType (#584) ───

test('backendProjectType reads the backend target entry, firebase unless it says custom', () => {
  assert.deepStrictEqual(BACKEND_PROJECT_TYPES, ['firebase', 'custom']);

  assert.equal(backendProjectType({ projectType: 'custom' }), 'custom');
  assert.equal(backendProjectType({ projectType: 'firebase' }), 'firebase');
  // An absent entry, an empty entry, and a nonsense value all read firebase —
  // the validator is what makes the nonsense loud; the reader never guesses a
  // brand OFF Cloud Functions.
  assert.equal(backendProjectType(undefined), 'firebase');
  assert.equal(backendProjectType({}), 'firebase');
  assert.equal(backendProjectType({ projectType: 'render' }), 'firebase');
  // It reads a RESOLVED backend config the same way — the target entry's keys
  // land at the top level there.
  assert.equal(backendProjectType({ brand: { id: 'b' }, projectType: 'custom' }), 'custom');
});

/**
 * The migrate rule set: the retired config keys (NAMES walked at every depth,
 * exact PATHS from the root) and the retired `.env` keys. The loader knows none
 * of them; `omega migrate` reports each one and converts it with `--execute`.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findRetiredKeys, RETIRED_KEYS, RETIRED_PATHS } = require('../src/migrate/retired-keys.js');
const { RETIRED_ENV_KEYS, findRetiredEnvKeys } = require('../src/migrate/retired-env.js');

const VALID = { brand: { id: 'sandbox-brand', name: 'Sandbox Brand' } };

// One line per finding, the shape the migrate report prints
const lines = (config) => findRetiredKeys(config).map(({ path, replacement, why }) => `${path} → ${replacement}: ${why}`);

// The row at `path` fired, and its line carries every word given
function fired(config, path, ...words) {
  return lines(config).some((line) => line.startsWith(`${path} → `) && words.every((word) => line.includes(word)));
}

// ─── the config table ───

test('every row names its replacement and why', () => {
  for (const [key, row] of [...Object.entries(RETIRED_KEYS), ...Object.entries(RETIRED_PATHS)]) {
    assert.equal(typeof row.replacement, 'string', `${key}: names where the setting went`);
    assert.ok(row.why.length > 0, `${key}: says why`);
  }
});

test('parent is retired OUTRIGHT, and its last meaning is company.webhooks (#677)', () => {
  for (const value of [false, 'self', 'https://api.example.com', true]) {
    assert.ok(fired({ ...VALID, parent: value }, 'parent', 'company.webhooks'), `parent: ${value} names the new home`);
  }
});

test('the flat provider picks are retired: one providers block per role (#425)', () => {
  const config = {
    ...VALID,
    translation: { languages: ['es'], provider: 'chatgpt' },
    domain: { provider: 'namecheap', email: { provider: 'cloudflare' } },
    devlog: { enabled: true, provider: 'ghostii', orgs: ['x'] },
    certificates: { apple: { bundleIdPrefix: 'com.acme' } },
    payment: { processors: { stripe: { publishableKey: 'pk_test_x' } } },
  };

  for (const [path, replacement] of [
    ['translation.provider', 'translation.providers.<name>'],
    ['domain.provider', 'domain.providers.<registrar>'],
    ['domain.email.provider', 'domain.email.providers.<provider>'],
    ['devlog.provider', 'devlog.providers.ghostii'],
    ['devlog.orgs', 'devlog.providers.ghostii.orgs'],
    ['certificates.apple', 'certificates.providers.apple'],
    ['payment.processors', 'payment.providers'],
  ]) {
    assert.ok(fired(config, path, `→ ${replacement}:`), `${path} should name ${replacement}`);
  }
});

test('every converted monitoring + marketing leaf is retired by its exact path (#425)', () => {
  const config = {
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
  };

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
    assert.ok(fired(config, path, `→ ${replacement}:`), `${path} should name ${replacement}`);
  }
});

test('a retired NAME fires wherever it sits: shared level and inside a target (#142)', () => {
  assert.ok(fired({ ...VALID, web_manager: { auth: { enabled: true } } }, 'web_manager', 'client'));
  assert.ok(fired({ ...VALID, targets: { web: { web_manager: { chatsy: {} } } } }, 'targets.web.web_manager', 'client'));
  assert.ok(fired({ ...VALID, firebaseConfig: { projectId: 'acme' } }, 'firebaseConfig', 'cloud'));
  assert.ok(fired({ ...VALID, targets: { web: { client: { cookieConsent: { enabled: false } } } } }, 'targets.web.client.cookieConsent', 'client.consent'));
});

test('the current client key is untouched by the table', () => {
  const config = { ...VALID, targets: { web: { type: 'web', client: { auth: {}, chatsy: {}, consent: {} } } } };

  assert.deepStrictEqual(findRetiredKeys(config), []);
});

test('#610: the legacy download and extension page maps name the blocks they derive from', () => {
  const config = {
    ...VALID,
    targets: { web: { type: 'web', download: { mac: { universal: 'https://acme.com/dl/mac' } }, extension: { chrome: 'https://acme.com/ext' } } },
  };

  assert.ok(fired(config, 'targets.web.download', 'targets.desktop.releases'));
  assert.ok(fired(config, 'targets.web.extension', 'targets.extension.listings'));
});

test('#850: the four schema-less web sections are retired, one row each', () => {
  const config = {
    ...VALID,
    targets: {
      web: {
        type: 'web',
        favicon: { path: 'https://cdn.acme.com/favicon', 'theme-color': '#ffffff' },
        manifest: { name: 'Acme' },
        icons: { style: 'solid' },
        currency: 'USD',
      },
    },
  };

  const named = { favicon: 'brand.images.favicon', manifest: 'site.webmanifest', icons: 'Font Awesome', currency: 'payment.currency' };
  for (const [key, replacement] of Object.entries(named)) {
    assert.ok(fired(config, `targets.web.${key}`, replacement), `${key} names what answers it now: ${lines(config).join(' | ')}`);
  }
});

test('#466 / #737 / #799: the web redirect map, the webpack externals and the downloads mirror keys', () => {
  assert.ok(fired({ ...VALID, targets: { web: { redirects: [{ from: '/c/:id', to: '/code?id=:id' }] } } }, 'targets.web.redirects', 'edge.providers.cloudflare.rules.redirect'));
  assert.ok(fired({ ...VALID, targets: { desktop: { em: { webpack: { externals: ['better-sqlite3'] } } } } }, 'targets.desktop.em.webpack.externals', 'esbuild'));

  const mirror = { ...VALID, targets: { desktop: { downloads: { enabled: true, owner: 'Acme-Org', repo: 'download-server', tag: 'installer' } } } };
  for (const key of ['enabled', 'owner', 'repo', 'tag']) {
    assert.ok(fired(mirror, `targets.desktop.downloads.${key}`, '#799'), `downloads.${key} names the releases repo`);
  }
});

test('every de-branded top-level key names its new home (#23)', () => {
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
    assert.ok(fired({ ...VALID, [key]: {} }, key, replacement), `${key} must name ${replacement}`);
  }

  assert.ok(fired({ ...VALID, advertising: { providers: { 'google-adsense': { client: 'ca-pub-1' } } } }, 'advertising.providers.google-adsense', 'advertising.providers.adsense'));
});

test('the retired adsense gates name the one switch (#628)', () => {
  for (const key of ['enabled', 'units']) {
    const config = { ...VALID, advertising: { providers: { adsense: { client: 'ca-pub-1', [key]: false } } } };
    assert.ok(fired(config, `advertising.providers.adsense.${key}`, 'advertising.providers.adsense', '#527'), `adsense.${key}`);
  }
});

test('#607: config meta.title / meta.description are retired, and only as PATHS', () => {
  const config = { ...VALID, meta: { title: 'Site default', description: 'Site desc' } };
  assert.ok(fired(config, 'meta.title', 'brand.name'));
  assert.ok(fired(config, 'meta.description', 'brand.description'));
  assert.ok(fired({ ...VALID, targets: { web: { meta: { title: 'Site default' } } } }, 'targets.web.meta.title', 'brand.name'));

  // The analytics provider named `meta` keeps its name
  assert.deepStrictEqual(findRetiredKeys({ ...VALID, analytics: { providers: { meta: { id: '123' } } } }), []);
  assert.deepStrictEqual(findRetiredKeys({ ...VALID, targets: { web: { type: 'web', meta: { index: false } } } }), []);
});

test('#564 / #858: seo.index and translation.exclude name their one-name homes', () => {
  assert.ok(fired({ ...VALID, seo: { index: false } }, 'seo.index', 'targets.web.meta.index'));
  assert.ok(fired({ ...VALID, translation: { exclude: ['docs'] } }, 'translation.exclude', 'translation.include'));
  assert.ok(fired({ ...VALID, targets: { web: { type: 'web', translation: { exclude: ['docs'] } } } }, 'targets.web.translation.exclude', 'translation.include'));
});

test('#858: the translation.exclude row CONVERTS: each skipped route becomes a negation', () => {
  const [finding] = findRetiredKeys({ ...VALID, translation: { exclude: ['docs', '/changelog/'] } });

  assert.deepStrictEqual(finding.convert(['docs', '/changelog/']), ['**', '!docs', '!changelog']);
});

test('#732 / #886: a targets.<type> row fires inside the entry, on a target NAMED anything', () => {
  const config = {
    ...VALID,
    targets: {
      web: { type: 'web', meta: { title: 'Site default' }, redirects: [{ from: '/c/:id', to: '/code?id=:id' }] },
      community: { type: 'web', meta: { title: 'Site default' } },
      app: { type: 'desktop', downloads: { enabled: true } },
    },
  };

  assert.ok(fired(config, 'targets.web.meta.title', 'brand.name'));
  assert.ok(fired(config, 'targets.web.redirects', 'edge.providers.cloudflare.rules.redirect'));
  assert.ok(fired(config, 'targets.community.meta.title', 'brand.name'), 'the second web target fires at its real path');
  assert.ok(fired(config, 'targets.app.downloads.enabled', '#799'), 'the renamed desktop target fires too');

  // A type that owns no such row stays clean
  assert.deepStrictEqual(findRetiredKeys({ ...VALID, targets: { docs: { type: 'custom', meta: { title: 'Docs' } } } }), []);
});

test('#588 / #788: subdomains and oauth2 are NAME rows, walked at every depth', () => {
  assert.ok(fired({ ...VALID, brand: { ...VALID.brand, subdomains: ['admin', 'cdn'] } }, 'brand.subdomains', 'targets.web', "admin: { type: 'web' }"));
  assert.ok(fired({ ...VALID, targets: { admin: { type: 'web', brand: { subdomains: ['x'] } } } }, 'targets.admin.brand.subdomains', 'targets.web'));
  assert.ok(fired({ ...VALID, oauth2: { discord: { enabled: true } } }, 'oauth2', 'connections'));
  assert.ok(fired({ ...VALID, targets: { backend: { oauth2: { google: {} } } } }, 'targets.backend.oauth2', 'connections'));
});

test('#883: every retired repo key names what replaced it', () => {
  const config = {
    ...VALID,
    repo: { providers: { github: { enabled: true, org: 'Acme-Org', repo: 'acme-site', shared: false, private: true } } },
    github: { user: 'acme', website: 'https://github.com/acme/acme-site' },
    targets: {
      web: { type: 'web' },
      api: { type: 'backend', github: { repo: 'acme-content' } },
      desktop: { type: 'desktop', releases: { owner: 'Acme-Binaries', repo: 'acme-bins' } },
    },
  };

  const rows = {
    'repo.providers.github.org': 'repo.org',
    'repo.providers.github.repo': '<brand.id>-omega',
    'repo.providers.github.private': 'package.json `private` field',
    'repo.providers.github.shared': 'org profile',
    'repo.providers.github.enabled': 'presence of the `repo` block',
    'github.user': 'repo.org',
    'github.website': '<brand.id>-<target name>',
    'targets.api.github.repo': '<brand.id>-<role>',
    'targets.desktop.releases.owner': '<brand.id>-releases',
    'targets.desktop.releases.repo': '<brand.id>-releases',
  };

  for (const [path, replacement] of Object.entries(rows)) {
    assert.ok(fired(config, path, replacement), `${path} must name ${replacement}: ${lines(config).join(' | ')}`);
  }
});

test('#647: product limits and rateLimit name the features catalog, at their real array path', () => {
  const config = { ...VALID, payment: { products: [{ id: 'basic', name: 'Basic', limits: { saves: 100 }, rateLimit: 'monthly' }] } };

  assert.ok(fired(config, 'payment.products.0.limits', 'payment.products[].features'), lines(config).join(' | '));
  assert.ok(fired(config, 'payment.products.0.rateLimit', 'features.<id>.usage.pace'), lines(config).join(' | '));
});

test('#677: the typed company name and parent wordmark name the resolved company', () => {
  const config = { ...VALID, brand: { ...VALID.brand, company: 'Acme Holdings Inc', images: { companyWordmark: '/wordmark.png' } } };

  assert.ok(fired(config, 'brand.company', 'company.name'));
  assert.ok(fired(config, 'brand.images.companyWordmark', 'company.images.wordmark'));
});

test('the top-level adsense section and download map are rows too (#859)', () => {
  const config = {
    ...VALID,
    adsense: { accountId: 'pub-0000000000000000' },
    download: { mac: { universal: 'https://acme.test/mac' }, linux: { debian: 'https://acme.test/deb', snap: 'https://acme.test/snap' } },
  };

  assert.ok(fired(config, 'adsense', 'advertising.providers.adsense.client'), lines(config).join(' | '));
  assert.ok(fired(config, 'download', 'targets.desktop.releases'), lines(config).join(' | '));
  assert.equal(findRetiredKeys(config).length, 2, 'one row per section, never one per leaf');

  // The live homes stay clean
  assert.deepStrictEqual(findRetiredKeys({ ...VALID, advertising: { providers: { adsense: { client: 'ca-pub-1' } } } }), []);
});

// ─── the .env table ───

test('every retired env key names its replacement and why', () => {
  assert.deepStrictEqual(Object.keys(RETIRED_ENV_KEYS).sort(), [
    'CHARGEBEE_SITE',
    'CHROME_EXTENSION_ID',
    'EDGE_PRODUCT_ID',
    'FIREFOX_EXTENSION_ID',
    'OAUTH2_GOOGLE_CLIENT_ID',
    'OAUTH2_GOOGLE_CLIENT_SECRET',
    'OMEGA_TEST_FIREBASE_ADMIN_KEY',
    'OMEGA_TEST_USER_UID',
    'PAYPAL_CLIENT_ID',
    'RECAPTCHA_SITE_KEY',
  ]);

  for (const [name, row] of Object.entries(RETIRED_ENV_KEYS)) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/, `${name}: env names are SCREAMING_SNAKE_CASE`);
    assert.ok(typeof row.why === 'string' && row.why.length > 0, `${name}: says why`);

    // `null` is a key retired outright: a MECHANISM replaced it, not a value
    if (row.replacement === null) continue;

    assert.ok(typeof row.replacement === 'string' && row.replacement.length > 0, `${name}: names its new home`);
    if (row.home === 'env') assert.match(row.replacement, /^[A-Z][A-Z0-9_]*$/, `${name}: an env-side rename names an env key`);
  }
});

test('an env-side rename names the new ENV key, not a config path (#845)', () => {
  for (const name of ['OAUTH2_GOOGLE_CLIENT_ID', 'OAUTH2_GOOGLE_CLIENT_SECRET']) {
    const row = RETIRED_ENV_KEYS[name];

    assert.equal(row.home, 'env', `${name}: its replacement lives in .env`);
    assert.equal(row.replacement, name.replace(/^OAUTH2_/, 'CONNECTIONS_'), `${name}: the prefix is the whole rename`);
  }
});

test('the test-lane pair is retired outright, naming the mechanism (#819)', () => {
  for (const name of ['OMEGA_TEST_FIREBASE_ADMIN_KEY', 'OMEGA_TEST_USER_UID']) {
    assert.equal(RETIRED_ENV_KEYS[name].replacement, null);
    assert.ok(RETIRED_ENV_KEYS[name].why.includes('#904'), `${name}: names the seeded persona`);
  }
});

test('findRetiredEnvKeys reports only the keys a layer carries, in its own order', () => {
  const found = findRetiredEnvKeys({ GH_TOKEN: 'x', EDGE_PRODUCT_ID: '111', CHARGEBEE_SITE: 'acme' });

  assert.deepStrictEqual(found.map((row) => row.key), ['EDGE_PRODUCT_ID', 'CHARGEBEE_SITE']);
  assert.equal(found[0].replacement, 'targets.<name>.listings.edge.id');
  assert.deepStrictEqual(findRetiredEnvKeys({ GH_TOKEN: 'x' }), [], 'a clean layer reports nothing');
  assert.deepStrictEqual(findRetiredEnvKeys({}), []);
});

test('a declared-but-empty line is still a retired line', () => {
  assert.deepStrictEqual(findRetiredEnvKeys({ RECAPTCHA_SITE_KEY: '' }).map((row) => row.key), ['RECAPTCHA_SITE_KEY']);
});

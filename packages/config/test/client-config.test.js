/**
 * client-config.test.js: clientConfig(), the ONE browser-safe subset
 * ([#894](https://github.com/Omega-JS-Stack/omega/issues/894)).
 *
 * Three surfaces bake a config into a public artifact (web's page chrome,
 * desktop's renderer bundle, every extension bundle), and each one used to
 * decide what a browser may see on its own: desktop shipped the WHOLE resolved
 * config, the extension kept a hand-written allow list, web wired a subset
 * together in its engine and its foot include. This function is that decision,
 * once, off the schema's own `client` flag.
 */

const test = require('node:test');
const assert = require('node:assert');
const { clientConfig, CLIENT_SECTIONS } = require('../src/index.js');

// A resolved config with one key in every shape the gate has to judge.
const RESOLVED = () => ({
  // client sections
  brand: { id: 'acme', name: 'Acme', url: 'https://acme.com' },
  company: { id: 'itw-creative-works', name: 'ITW', url: 'https://itw.com' },
  theme: { id: 'classy', appearance: 'dark' },
  analytics: { providers: { google: { id: 'G-1' } } },
  advertising: { providers: { adsense: { client: 'ca-pub-1' } } },
  captcha: { providers: { recaptcha: { siteKey: 'site-key' } } },
  monitoring: { enabled: true, providers: { sentry: { dsn: 'https://dsn' } } },
  connections: { twitch: { clientId: 'twitch-client' } },
  features: { requests: { name: 'Requests' } },
  payment: { providers: { stripe: { publishableKey: 'pk_live' } }, products: [] },
  client: { consent: { enabled: true }, auth: { config: { policy: 'authenticated' } } },
  listings: { chrome: { id: 'abcdefghijklmnopqrstuvwxyzabcdef' } },
  cloud: {
    provider: 'firebase',
    config: { apiKey: 'public-web-key', projectId: 'acme' },
    messaging: { vapidKey: 'vapid' },
    // Provisioning facts a browser has no use for
    billingAccount: '01ABCD-234567-89EFGH',
    organizationId: '123456789',
    apiSubdomain: true,
  },
  forms: { providers: { slapform: { formId: 'form-1', plan: 'pro', templateId: 'tpl-1' } } },
  inbound: {
    chat: { providers: { chatsy: { enabled: true, agentId: 'agent-1', settings: { button: {} }, plan: 'pro' } } },
    email: { providers: { postmark: { serverId: 'srv-1' } } },
  },

  // build facts every surface composes
  runtime: 'browser-extension',
  environment: 'production',
  version: '3.1.4',
  buildTime: 1757000000000,
  target: 'extension',
  url: 'https://acme.com',
  dev: { ports: { backend: 5002 }, origin: 'https://localhost:4001' },

  // sections the browser never sees
  account: { enabled: true, admins: [{ email: 'root@acme.com' }] },
  repo: { provider: 'github', org: 'Acme-Org' },
  edge: { providers: { cloudflare: { zone: 'acme.com' } } },
  certificates: { providers: { apple: { teamId: 'TEAM' } } },
  domain: { namecheap: {} },
  search: { providers: { google: { property: 'acme.com' } } },
  marketing: { campaigns: {}, newsletter: {} },
  translation: { enabled: true, languages: ['es'] },
  platforms: { windows: { signing: 'cloud' } },
  releases: { enabled: true },
  restartManager: true,
  remoteScripts: true,
  hosting: { provider: 'github' },
  purgecss: { safelist: { standard: ['x'] } },
  collections: { docs: { field: 'doc.category' } },
  categories: ['privacy-security'],
  targets: { web: { type: 'web' }, extension: { type: 'extension' } },
  type: 'extension',
});

test('the client sections ride whole', () => {
  const client = clientConfig(RESOLVED());

  assert.deepStrictEqual(client.brand, { id: 'acme', name: 'Acme', url: 'https://acme.com' });
  assert.deepStrictEqual(client.theme, { id: 'classy', appearance: 'dark' });
  assert.deepStrictEqual(client.analytics, { providers: { google: { id: 'G-1' } } });
  assert.deepStrictEqual(client.advertising, { providers: { adsense: { client: 'ca-pub-1' } } });
  assert.deepStrictEqual(client.captcha, { providers: { recaptcha: { siteKey: 'site-key' } } });
  assert.deepStrictEqual(client.monitoring, { enabled: true, providers: { sentry: { dsn: 'https://dsn' } } });
  assert.deepStrictEqual(client.connections, { twitch: { clientId: 'twitch-client' } });
  assert.deepStrictEqual(client.features, { requests: { name: 'Requests' } });
  assert.deepStrictEqual(client.client, { consent: { enabled: true }, auth: { config: { policy: 'authenticated' } } });
  assert.deepStrictEqual(client.listings, { chrome: { id: 'abcdefghijklmnopqrstuvwxyzabcdef' } });
});

test('a non-client section NEVER passes', () => {
  const client = clientConfig(RESOLVED());

  for (const section of [
    'account', 'repo', 'edge', 'certificates', 'domain', 'search', 'marketing', 'translation',
    'platforms', 'releases', 'restartManager', 'remoteScripts', 'hosting', 'purgecss',
    'collections', 'categories', 'targets', 'type',
  ]) {
    assert.strictEqual(client[section], undefined, `${section} must never reach a browser`);
  }
});

test('cloud rides its PUBLIC half only: the web config, not the GCP account', () => {
  const client = clientConfig(RESOLVED());

  // The Firebase web config is public by design, and the client boots from it
  assert.deepStrictEqual(client.cloud.config, { apiKey: 'public-web-key', projectId: 'acme' });
  assert.deepStrictEqual(client.cloud.messaging, { vapidKey: 'vapid' });
  // The provisioning facts stay in the build
  assert.strictEqual(client.cloud.billingAccount, undefined);
  assert.strictEqual(client.cloud.organizationId, undefined);
  assert.strictEqual(client.cloud.apiSubdomain, undefined);
  assert.strictEqual(client.cloud.provider, undefined);
});

test('forms and inbound ride the LEAVES the runtime reads, never their provisioning siblings', () => {
  const client = clientConfig(RESOLVED());

  assert.deepStrictEqual(client.forms, { providers: { slapform: { formId: 'form-1' } } });
  assert.deepStrictEqual(client.inbound, {
    chat: { providers: { chatsy: { enabled: true, agentId: 'agent-1', settings: { button: {} } } } },
  });
});

test('every build fact rides', () => {
  const resolved = RESOLVED();
  const client = clientConfig(resolved);

  assert.strictEqual(client.runtime, 'browser-extension');
  assert.strictEqual(client.environment, 'production');
  assert.strictEqual(client.version, '3.1.4');
  assert.strictEqual(client.buildTime, 1757000000000);
  assert.strictEqual(client.target, 'extension');
  assert.strictEqual(client.url, 'https://acme.com');
  assert.deepStrictEqual(client.dev, resolved.dev);
  // The resolved company (#677) is a config section, and the browser reads it
  assert.deepStrictEqual(client.company, resolved.company);
});

test('a secret-shaped key inside a client section FAILS the build', () => {
  const resolved = RESOLVED();
  resolved.connections.twitch.clientSecret = 'never-in-a-bundle';

  assert.throws(
    () => clientConfig(resolved),
    (error) => {
      assert.match(error.message, /connections\.twitch\.clientSecret/);
      assert.match(error.message, /\.env/);
      return true;
    },
  );
});

test('a secret-shaped key in a NON-client section is nobody\'s business here', () => {
  const resolved = RESOLVED();
  resolved.edge.providers.cloudflare.apiToken = 'stays-in-the-build';

  assert.strictEqual(clientConfig(resolved).edge, undefined);
});

test('payment rides with its winback offer RESOLVED, so the dialog and the coupon agree', () => {
  const client = clientConfig(RESOLVED());

  assert.deepStrictEqual(client.payment.providers, { stripe: { publishableKey: 'pk_live' } });
  // The framework default (@omega.js/config's one home) is materialized here
  assert.strictEqual(client.payment.winback.enabled, true);
  assert.strictEqual(client.payment.winback.percent, 50);
  assert.strictEqual(client.payment.winback.duration, 'once');
});

test('an empty resolved config answers an empty subset, never a throw', () => {
  assert.deepStrictEqual(clientConfig({}), {});
  assert.deepStrictEqual(clientConfig(), {});
});

test('the subset never aliases the resolved config: a caller mutation cannot reach it', () => {
  const resolved = RESOLVED();
  const client = clientConfig(resolved);

  client.brand.name = 'Mutated';
  assert.strictEqual(resolved.brand.name, 'Acme');
});

test('the flag is DECLARED once, in the schema', () => {
  assert.strictEqual(CLIENT_SECTIONS.brand, true);
  assert.strictEqual(CLIENT_SECTIONS.account, undefined);
  assert.ok(Array.isArray(CLIENT_SECTIONS.cloud));
});

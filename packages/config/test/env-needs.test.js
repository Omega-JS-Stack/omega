/**
 * Unit tests for @omega.js/config's one "which env keys is this brand missing"
 * function. Given a brand's config, an env, an optional target and a verb, it
 * returns each missing key with its kind: `required` (the config depends on
 * it, so a deploy or a production start refuses), `asked` (the feature is on,
 * so manage asks and the person may skip) or `ship` (a declared ship format
 * cannot publish without it). Plain config and env objects only: no file is read.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { missingEnvKeys, missingConfigKeys, baseMissingKeys, ENV_VERBS } = require('../src/index.js');

/**
 * The rows as sorted, unique [key, need] pairs, the shape most cases compare.
 * A key two services ask for is one pair here.
 * @param {Array<{ key: string, need: string }>} rows - What missingEnvKeys returned.
 * @returns {Array<[string, string]>} Sorted pairs.
 */
const pairs = (rows) => [...new Set(rows.map(({ key, need }) => `${key} ${need}`))].sort().map((pair) => pair.split(' '));

/**
 * The rows for the named keys only, as sorted [key, need] pairs.
 * @param {Array<{ key: string, need: string }>} rows - What missingEnvKeys returned.
 * @param {string[]} keys - The keys to keep.
 * @returns {Array<[string, string]>} Sorted pairs.
 */
const pairsFor = (rows, keys) => pairs(rows.filter((row) => keys.includes(row.key)));

const REAL_PROJECT = { provider: 'firebase', config: { projectId: 'acme-live' } };
const DEMO_PROJECT = { provider: 'firebase', config: { projectId: 'demo-acme' } };
const SITE_KEY = { captcha: { providers: { recaptcha: { siteKey: '6Lc-public-site-key' } } } };
const GA_ID = { analytics: { providers: { google: { id: 'G-ACME123' } } } };
const MINTED = ['OMEGA_ADMIN_KEY', 'OMEGA_NAMESPACE', 'OMEGA_WEBHOOK_KEY', 'UNSUBSCRIBE_HMAC_KEY'];
const MINTED_ENV = Object.fromEntries(MINTED.map((key) => [key, 'minted']));
const AZURE = ['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'AZURE_TRUSTED_SIGNING_ENDPOINT'];
const SNAP = 'SNAPCRAFT_STORE_CREDENTIALS';
const SELF_HOSTED = ['WIN_CSC_KEY_PASSWORD', 'WIN_EV_TOKEN_PATH'];
const DEFAULT_SHIP = [SNAP, ...SELF_HOSTED];

// Every key whose entry names the backend as its one reader (the key map's
// "Targets: backend" rows), hard-coded so the case never reads the schema.
const BACKEND_ONLY = [
  'OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY',
  'RECAPTCHA_SECRET_KEY', 'HCAPTCHA_SECRET', 'META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN',
  'SENDGRID_API_KEY', 'BEEHIIV_API_KEY',
  'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'CHARGEBEE_API_KEY', 'COINBASE_COMMERCE_API_KEY',
  'ANTHROPIC_API_KEY', 'NEVERBOUNCE_API_KEY', 'ZEROBOUNCE_API_KEY', 'GOOGLE_ANALYTICS_SECRET_BACKEND',
];

/**
 * A brand config with many features on: a real project and the given targets.
 * @param {object} targets - The targets map.
 * @param {object} [extra] - Shared sections beside them.
 * @returns {object} The config.
 */
function brand(targets, extra = {}) {
  return {
    brand: { id: 'acme', name: 'Acme' },
    cloud: REAL_PROJECT,
    ...SITE_KEY,
    ...GA_ID,
    monitoring: { providers: { sentry: { org: 'acme', dsn: 'https://public@o0.ingest.sentry.io/0' } } },
    payment: { providers: { stripe: { publishableKey: 'pk_test_acme' } } },
    ...extra,
    targets,
  };
}

// ─── Cases 3 and 4: reCAPTCHA, asked and required ───────────────────────────

const CAPTCHA_BRAND = {
  brand: { id: 'acme', name: 'Acme' },
  cloud: REAL_PROJECT,
  targets: { web: { type: 'web' }, backend: { type: 'backend' } },
};

// ─── Case 5: the ship-format table ──────────────────────────────────────────

const AZURE_BRAND = {
  brand: { id: 'acme', name: 'Acme' },
  cloud: REAL_PROJECT,
  targets: {
    desktop: { type: 'desktop', platforms: { windows: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } },
  },
};

// ─── A default desktop format owes its keys ─────────────────────────────────

/**
 * A brand with one desktop target carrying the given platforms block.
 * @param {object} [platforms] - The target's platforms block; none when absent.
 * @returns {object} The config.
 */
const desktopBrand = (platforms) => ({
  brand: { id: 'acme', name: 'Acme' },
  cloud: REAL_PROJECT,
  targets: { desktop: platforms ? { type: 'desktop', platforms } : { type: 'desktop' } },
});

module.exports = defineCases({
  type: 'group',
  description: 'env-needs',
  tests: [
    {
      name: 'ENV_VERBS: the verbs every caller asks the question for',
      run: (ctx) => {
        ctx.expect([...ENV_VERBS].sort()).toEqual(['build', 'deploy', 'dev', 'manage', 'onboard', 'publish', 'start', 'status']);
      },
    },

    // ─── Case 1: no backend target, no backend key ──────────────────────────────

    {
      name: 'case 1: a brand with no backend target is never asked for a key only the backend reads, on any verb',
      run: (ctx) => {
        const config = brand({ web: { type: 'web' }, desktop: { type: 'desktop' }, extension: { type: 'extension' } });

        for (const verb of ENV_VERBS) {
          for (const target of [undefined, 'web', 'desktop', 'extension']) {
            const leaked = missingEnvKeys(config, {}, { target, verb }).filter((row) => BACKEND_ONLY.includes(row.key));
            ctx.expect(pairs(leaked), `${verb}${target ? ` on ${target}` : ''}`).toEqual([]);
          }
        }

        // The same brand with a backend owes them: the case above is not vacuous
        const withBackend = missingEnvKeys({ ...config, targets: { ...config.targets, backend: { type: 'backend' } } }, {}, { verb: 'manage' });
        ctx.expect(withBackend.some((row) => row.key === 'RECAPTCHA_SECRET_KEY'), 'a backend brand is asked for its reCAPTCHA secret').toBeTruthy();
      },
    },

    // ─── Case 2: a demo project is local only ───────────────────────────────────

    {
      name: 'case 2: a demo project is never asked for a cloud key, on any verb',
      run: (ctx) => {
        const config = brand({ web: { type: 'web' }, backend: { type: 'backend' } }, { cloud: DEMO_PROJECT });

        for (const verb of ENV_VERBS) {
          const cloud = missingEnvKeys(config, {}, { verb }).filter((row) => row.service === 'cloud');
          ctx.expect(pairs(cloud), verb).toEqual([]);
        }

        // A real project id is what makes the cloud keys asked
        const real = missingEnvKeys({ ...config, cloud: REAL_PROJECT }, {}, { verb: 'manage' }).filter((row) => row.service === 'cloud');
        ctx.expect(pairsFor(real, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])).toEqual([
          ['GOOGLE_CLIENT_ID', 'asked'],
          ['GOOGLE_CLIENT_SECRET', 'asked'],
        ]);
      },
    },

    {
      name: 'case 2 stops at the cloud service: an AdSense client on a website with no cloud block still asks for the Google client',
      run: (ctx) => {
        const config = { brand: { id: 'acme', name: 'Acme' }, advertising: { providers: { adsense: { client: 'ca-pub-1' } } }, targets: { web: { type: 'web' } } };

        const advertising = missingEnvKeys(config, {}, { verb: 'manage' }).filter((row) => row.service === 'advertising');
        ctx.expect(pairsFor(advertising, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])).toEqual([
          ['GOOGLE_CLIENT_ID', 'asked'],
          ['GOOGLE_CLIENT_SECRET', 'asked'],
        ]);
      },
    },

    {
      name: 'case 2 is about a demo id only: a brand with no project id yet still gets the cloud service\'s ask',
      run: (ctx) => {
        const config = { brand: { id: 'acme', name: 'Acme' }, targets: { web: { type: 'web' }, backend: { type: 'backend' } } };

        const cloud = missingEnvKeys(config, {}, { verb: 'manage' }).filter((row) => row.service === 'cloud');
        ctx.expect(pairsFor(cloud, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])).toEqual([
          ['GOOGLE_CLIENT_ID', 'asked'],
          ['GOOGLE_CLIENT_SECRET', 'asked'],
        ]);
      },
    },

    {
      name: 'case 3: manage asks for the reCAPTCHA secret while reCAPTCHA is not turned off',
      run: (ctx) => {
        const rows = missingEnvKeys(CAPTCHA_BRAND, {}, { verb: 'manage' }).filter((row) => row.key === 'RECAPTCHA_SECRET_KEY');
        ctx.expect(rows.map(({ key, need, service }) => ({ key, need, service }))).toEqual([{ key: 'RECAPTCHA_SECRET_KEY', need: 'asked', service: 'captcha' }]);

        const off = { ...CAPTCHA_BRAND, captcha: { providers: { recaptcha: { enabled: false } } } };
        ctx.expect(pairsFor(missingEnvKeys(off, {}, { verb: 'manage' }), ['RECAPTCHA_SECRET_KEY']), 'turned off, never asked').toEqual([]);

        // Asked, and present, is not missing
        ctx.expect(pairsFor(missingEnvKeys(CAPTCHA_BRAND, { RECAPTCHA_SECRET_KEY: 'shh' }, { verb: 'manage' }), ['RECAPTCHA_SECRET_KEY'])).toEqual([]);
      },
    },

    {
      name: 'case 4: deploy requires the reCAPTCHA secret only once the site key is set',
      run: (ctx) => {
        const noSiteKey = missingEnvKeys(CAPTCHA_BRAND, MINTED_ENV, { target: 'backend', verb: 'deploy' });
        ctx.expect(pairsFor(noSiteKey, ['RECAPTCHA_SECRET_KEY']), 'reCAPTCHA is on, but nothing depends on its secret yet').toEqual([]);

        const siteKey = missingEnvKeys({ ...CAPTCHA_BRAND, ...SITE_KEY }, MINTED_ENV, { target: 'backend', verb: 'deploy' });
        ctx.expect(pairsFor(siteKey, ['RECAPTCHA_SECRET_KEY'])).toEqual([['RECAPTCHA_SECRET_KEY', 'required']]);

        // An empty value is an absent one: presence, never shape
        const empty = missingEnvKeys({ ...CAPTCHA_BRAND, ...SITE_KEY }, { ...MINTED_ENV, RECAPTCHA_SECRET_KEY: '' }, { target: 'backend', verb: 'deploy' });
        ctx.expect(pairsFor(empty, ['RECAPTCHA_SECRET_KEY'])).toEqual([['RECAPTCHA_SECRET_KEY', 'required']]);

        // ...and the value itself is never judged
        const set = missingEnvKeys({ ...CAPTCHA_BRAND, ...SITE_KEY }, { ...MINTED_ENV, RECAPTCHA_SECRET_KEY: 'not-a-recaptcha-secret' }, { target: 'backend', verb: 'deploy' });
        ctx.expect(pairs(set)).toEqual([]);
      },
    },

    {
      name: 'case 5: publish needs the four Azure keys to ship, and manage asks for them',
      run: (ctx) => {
        const publish = missingEnvKeys(AZURE_BRAND, {}, { target: 'desktop', verb: 'publish' });
        ctx.expect(pairsFor(publish, AZURE)).toEqual(AZURE.map((key) => [key, 'ship']));

        const manage = missingEnvKeys(AZURE_BRAND, {}, { verb: 'manage' });
        ctx.expect(pairsFor(manage, AZURE)).toEqual(AZURE.map((key) => [key, 'asked']));

        // Another provider's keys are not this brand's
        const others = ['SSLCOM_USERNAME', 'SSLCOM_PASSWORD', 'SSLCOM_CREDENTIAL_ID', 'DIGICERT_API_KEY', 'DIGICERT_KEYPAIR_ALIAS', 'WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD'];
        ctx.expect(pairsFor(publish, others)).toEqual([]);
        ctx.expect(pairsFor(manage, others)).toEqual([]);
      },
    },

    {
      name: 'a desktop target that declares no platforms owes the snap login and the self-hosted pair, on publish, deploy and manage',
      run: (ctx) => {
        const config = desktopBrand();

        ctx.expect(pairsFor(missingEnvKeys(config, {}, { target: 'desktop', verb: 'publish' }), DEFAULT_SHIP)).toEqual(DEFAULT_SHIP.map((key) => [key, 'ship']));
        ctx.expect(pairsFor(missingEnvKeys(config, {}, { target: 'desktop', verb: 'deploy' }), DEFAULT_SHIP)).toEqual(DEFAULT_SHIP.map((key) => [key, 'required']));
        ctx.expect(pairsFor(missingEnvKeys(config, {}, { verb: 'manage' }), DEFAULT_SHIP)).toEqual(DEFAULT_SHIP.map((key) => [key, 'asked']));

        // A snap row names the format's path, the one a refusal points at
        const snap = missingEnvKeys(config, {}, { target: 'desktop', verb: 'publish' }).find((row) => row.key === SNAP);
        ctx.expect(snap.path).toBe('platforms.linux.formats.snap');

        // Set, they are not missing
        const env = Object.fromEntries(DEFAULT_SHIP.map((key) => [key, 'set']));
        ctx.expect(pairsFor(missingEnvKeys(config, env, { target: 'desktop', verb: 'publish' }), DEFAULT_SHIP)).toEqual([]);
      },
    },

    {
      name: 'a declared snap owes its login the same as a default one',
      run: (ctx) => {
        const declared = desktopBrand({ linux: { formats: { snap: { channels: ['stable'] } } } });
        ctx.expect(pairsFor(missingEnvKeys(declared, {}, { target: 'desktop', verb: 'publish' }), [SNAP])).toEqual([[SNAP, 'ship']]);
      },
    },

    {
      name: 'the snap login is not owed once the snap or the whole of linux is turned off',
      run: (ctx) => {
        for (const platforms of [{ linux: { formats: { snap: false } } }, { linux: false }]) {
          const config = desktopBrand(platforms);
          for (const [verb, target] of [['publish', 'desktop'], ['deploy', 'desktop'], ['manage', undefined]]) {
            ctx.expect(pairsFor(missingEnvKeys(config, {}, { target, verb }), [SNAP]), `${JSON.stringify(platforms)} on ${verb}`).toEqual([]);
          }
          // Turning the snap off leaves the Windows pair owed
          ctx.expect(pairsFor(missingEnvKeys(config, {}, { target: 'desktop', verb: 'publish' }), SELF_HOSTED)).toEqual(SELF_HOSTED.map((key) => [key, 'ship']));
        }
      },
    },

    {
      name: 'neither self-hosted Windows key is owed once Windows or its installer is turned off',
      run: (ctx) => {
        for (const platforms of [{ windows: false }, { windows: { formats: { nsis: false } } }]) {
          const config = desktopBrand(platforms);
          for (const [verb, target] of [['publish', 'desktop'], ['deploy', 'desktop'], ['manage', undefined]]) {
            ctx.expect(pairsFor(missingEnvKeys(config, {}, { target, verb }), SELF_HOSTED), `${JSON.stringify(platforms)} on ${verb}`).toEqual([]);
          }
          // The snap is still on, so its login is still owed
          ctx.expect(pairsFor(missingEnvKeys(config, {}, { target: 'desktop', verb: 'publish' }), [SNAP])).toEqual([[SNAP, 'ship']]);
        }
      },
    },

    {
      name: 'the cloud strategy with Azure owes the four Azure keys and neither self-hosted key',
      run: (ctx) => {
        const config = desktopBrand({ windows: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } });

        const publish = missingEnvKeys(config, {}, { target: 'desktop', verb: 'publish' });
        ctx.expect(pairsFor(publish, SELF_HOSTED)).toEqual([]);
        ctx.expect(pairsFor(publish, AZURE)).toEqual(AZURE.map((key) => [key, 'ship']));
        ctx.expect(pairsFor(missingEnvKeys(config, {}, { target: 'desktop', verb: 'deploy' }), SELF_HOSTED)).toEqual([]);
      },
    },

    {
      name: 'a brand with no desktop target owes none of the three default-format keys, on any verb',
      run: (ctx) => {
        const config = brand({ web: { type: 'web' }, backend: { type: 'backend' }, extension: { type: 'extension' } });

        for (const verb of ENV_VERBS) {
          for (const target of [undefined, 'web', 'backend', 'extension']) {
            ctx.expect(pairsFor(missingEnvKeys(config, {}, { target, verb }), DEFAULT_SHIP), `${verb}${target ? ` on ${target}` : ''}`).toEqual([]);
          }
        }
      },
    },

    {
      name: 'case 5: an extension that ships to one store needs that store\'s keys only',
      run: (ctx) => {
        const chromeOnly = { ...AZURE_BRAND, targets: { extension: { type: 'extension', platforms: { firefox: false, edge: false } } } };
        const stores = ['CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN', 'FIREFOX_API_KEY', 'FIREFOX_API_SECRET', 'EDGE_CLIENT_ID', 'EDGE_API_KEY'];

        ctx.expect(pairsFor(missingEnvKeys(chromeOnly, {}, { target: 'extension', verb: 'publish' }), stores)).toEqual([
          ['CHROME_CLIENT_ID', 'ship'],
          ['CHROME_CLIENT_SECRET', 'ship'],
          ['CHROME_REFRESH_TOKEN', 'ship'],
        ]);
      },
    },

    // ─── Case 6: the keys OMEGA makes ───────────────────────────────────────────

    {
      name: 'case 6: an absent key OMEGA makes is required for the backend\'s start, a present one is not',
      run: (ctx) => {
        const config = { brand: { id: 'acme', name: 'Acme' }, cloud: DEMO_PROJECT, targets: { backend: { type: 'backend' } } };

        // The minted four are the only unconditional requirement: a brand with no
        // Stripe account, no GA4 id and no captcha still starts
        ctx.expect(pairs(missingEnvKeys(config, {}, { target: 'backend', verb: 'start' }))).toEqual(MINTED.map((key) => [key, 'required']));
        ctx.expect(pairs(missingEnvKeys(config, MINTED_ENV, { target: 'backend', verb: 'start' }))).toEqual([]);

        const oneGone = { ...MINTED_ENV };
        delete oneGone.OMEGA_NAMESPACE;
        ctx.expect(pairs(missingEnvKeys(config, oneGone, { target: 'backend', verb: 'start' }))).toEqual([['OMEGA_NAMESPACE', 'required']]);
      },
    },

    // ─── What every brand owes ──────────────────────────────────────────────────

    {
      name: 'baseMissingKeys: an empty env owes the backend\'s start exactly the minted four',
      run: (ctx) => {
        const rows = baseMissingKeys({}, { target: 'backend', verb: 'start' });

        ctx.expect(pairs(rows)).toEqual(MINTED.map((key) => [key, 'required']));
        // The same rows the one answer gives for a config that says nothing
        ctx.expect(rows).toEqual(missingEnvKeys({}, {}, { target: 'backend', verb: 'start' }));
      },
    },

    {
      name: 'baseMissingKeys: one function, exported from env-needs.js and the package index',
      run: (ctx) => {
        ctx.expect(typeof baseMissingKeys).toBe('function');
        ctx.expect(require('../src/env-needs.js').baseMissingKeys).toBe(baseMissingKeys);
      },
    },

    {
      name: 'baseMissingKeys: an env holding the minted four owes nothing',
      run: (ctx) => {
        ctx.expect(baseMissingKeys(MINTED_ENV, { target: 'backend', verb: 'start' })).toEqual([]);
      },
    },

    {
      name: 'baseMissingKeys: a website\'s start owes nothing',
      run: (ctx) => {
        ctx.expect(baseMissingKeys({}, { target: 'web', verb: 'start' })).toEqual([]);
      },
    },

    {
      name: 'missingConfigKeys: the key a config adds, and none of the keys every brand owes',
      run: (ctx) => {
        const config = { ...CAPTCHA_BRAND, ...SITE_KEY };
        const added = missingConfigKeys(config, {}, { target: 'backend', verb: 'start' });

        ctx.expect(pairs(added)).toEqual([['RECAPTCHA_SECRET_KEY', 'required']]);
        const base = new Set(baseMissingKeys({}, { target: 'backend', verb: 'start' }).map((row) => row.key));
        ctx.expect(added.filter((row) => base.has(row.key))).toEqual([]);
      },
    },

    // ─── Case 7: the delivery name ──────────────────────────────────────────────

    {
      name: 'case 7: a key present under its delivery name counts as present',
      run: (ctx) => {
        const config = { brand: { id: 'acme', name: 'Acme' }, cloud: REAL_PROJECT, ...GA_ID, targets: { web: { type: 'web' }, backend: { type: 'backend' } } };

        for (const [target, key] of [['web', 'GOOGLE_ANALYTICS_SECRET_WEB'], ['backend', 'GOOGLE_ANALYTICS_SECRET_BACKEND']]) {
          // Missing under either name: the row names the key a human sets in the brand .env
          ctx.expect(pairsFor(missingEnvKeys(config, MINTED_ENV, { target, verb: 'deploy' }), [key]), target).toEqual([[key, 'required']]);

          // A target's own build holds the delivered name, never the brand one
          ctx.expect(pairsFor(missingEnvKeys(config, { ...MINTED_ENV, GOOGLE_ANALYTICS_SECRET: 'shh' }, { target, verb: 'deploy' }), [key]), target).toEqual([]);
          ctx.expect(pairsFor(missingEnvKeys(config, { ...MINTED_ENV, [key]: 'shh' }, { target, verb: 'deploy' }), [key]), target).toEqual([]);
        }
      },
    },

    {
      name: 'the GA Measurement Protocol secret is owed by each target that has a stream id, and only by its own',
      run: (ctx) => {
        const config = {
          brand: { id: 'acme', name: 'Acme' },
          cloud: REAL_PROJECT,
          ...GA_ID,
          targets: { web: { type: 'web' }, backend: { type: 'backend' }, desktop: { type: 'desktop' }, extension: { type: 'extension' } },
        };
        const GA = ['GOOGLE_ANALYTICS_SECRET_WEB', 'GOOGLE_ANALYTICS_SECRET_BACKEND', 'GOOGLE_ANALYTICS_SECRET_DESKTOP', 'GOOGLE_ANALYTICS_SECRET_EXTENSION', 'GOOGLE_ANALYTICS_SECRET'];

        for (const [target, key] of [['web', 'GOOGLE_ANALYTICS_SECRET_WEB'], ['backend', 'GOOGLE_ANALYTICS_SECRET_BACKEND'], ['desktop', 'GOOGLE_ANALYTICS_SECRET_DESKTOP'], ['extension', 'GOOGLE_ANALYTICS_SECRET_EXTENSION']]) {
          ctx.expect(pairsFor(missingEnvKeys(config, MINTED_ENV, { target, verb: 'deploy' }), GA), target).toEqual([[key, 'required']]);
        }

        // No GA4 id, no secret owed anywhere
        const noId = { ...config, analytics: { providers: { google: {} } } };
        ctx.expect(pairsFor(missingEnvKeys(noId, MINTED_ENV, { target: 'extension', verb: 'deploy' }), GA)).toEqual([]);
      },
    },

    // ─── Case 8: onboarding asks for nothing ────────────────────────────────────

    {
      name: 'case 8: onboarding asks for no key at all',
      run: (ctx) => {
        const config = brand({ web: { type: 'web' }, backend: { type: 'backend' }, desktop: { type: 'desktop' }, extension: { type: 'extension' } });

        const asked = missingEnvKeys(config, {}, { verb: 'onboard' }).filter((row) => row.need === 'asked');
        ctx.expect(pairs(asked)).toEqual([]);

        // The same brand under manage is asked plenty: the case above is not vacuous
        ctx.expect(missingEnvKeys(config, {}, { verb: 'manage' }).some((row) => row.need === 'asked')).toBeTruthy();
      },
    },

    // ─── The rules carried over from the retired checker ────────────────────────

    {
      name: 'the Windows signing strategy owes its own credentials and no other\'s',
      run: (ctx) => {
        const signing = (value) => ({ brand: { id: 'acme', name: 'Acme' }, cloud: REAL_PROJECT, targets: { desktop: { type: 'desktop', platforms: { windows: { signing: value } } } } });
        const owed = SELF_HOSTED.map((key) => [key, 'required']);

        ctx.expect(pairsFor(missingEnvKeys(signing({ strategy: 'self-hosted' }), {}, { target: 'desktop', verb: 'deploy' }), SELF_HOSTED)).toEqual(owed);
        // Self-hosted is the default, so a desktop target that writes no strategy owes the same pair
        ctx.expect(pairsFor(missingEnvKeys(signing({}), {}, { target: 'desktop', verb: 'deploy' }), SELF_HOSTED)).toEqual(owed);
        // A brand on the cloud strategy owes no EV token
        ctx.expect(pairsFor(missingEnvKeys(signing({ strategy: 'cloud', cloud: { provider: 'azure' } }), {}, { target: 'desktop', verb: 'deploy' }), SELF_HOSTED)).toEqual([]);
      },
    },

    {
      name: 'the Sentry token is asked once Sentry is chosen, before any Sentry project exists',
      run: (ctx) => {
        const base = { brand: { id: 'acme', name: 'Acme' }, cloud: REAL_PROJECT, targets: { web: { type: 'web' } } };
        const chosen = { ...base, monitoring: { providers: { sentry: { org: 'acme' } } } };

        ctx.expect(pairsFor(missingEnvKeys(chosen, {}, { verb: 'manage' }), ['SENTRY_AUTH_TOKEN'])).toEqual([['SENTRY_AUTH_TOKEN', 'asked']]);
        ctx.expect(pairsFor(missingEnvKeys(base, {}, { verb: 'manage' }), ['SENTRY_AUTH_TOKEN']), 'no Sentry, no token').toEqual([]);
      },
    },

    {
      name: 'a pattern family has no fixed name, so it is never returned',
      run: (ctx) => {
        const config = brand({ web: { type: 'web' }, backend: { type: 'backend' } });

        for (const verb of ENV_VERBS) {
          const family = missingEnvKeys(config, { CONNECTIONS_ACME_CLIENT_ID: '' }, { target: 'backend', verb }).filter((row) => /^CONNECTIONS_/.test(row.key));
          ctx.expect(family, verb).toEqual([]);
        }
      },
    },

    {
      name: 'every row names its key, one of the three needs, and a service, once per (key, service) pair',
      run: (ctx) => {
        const config = brand({ web: { type: 'web' }, backend: { type: 'backend' }, desktop: { type: 'desktop' }, extension: { type: 'extension' } });

        for (const verb of ENV_VERBS) {
          const rows = missingEnvKeys(config, {}, { verb });
          for (const row of rows) {
            // Beside these a row may carry the rule's text, for the caller that prints it
            ctx.expect(typeof row.key, `${verb}: a key`).toBe('string');
            ctx.expect(['required', 'asked', 'ship'].includes(row.need), `${verb}: ${row.key} is ${row.need}`).toBeTruthy();
            ctx.expect(typeof row.service, `${verb}: ${row.key}`).toBe('string');
          }
          // Several services may ask for one key, so a row is one (key, service) pair
          const pairsSeen = rows.map((row) => `${row.key} ${row.service}`);
          ctx.expect(new Set(pairsSeen).size, `${verb}: no (key, service) pair twice`).toBe(pairsSeen.length);
        }
      },
    },
  ],
});

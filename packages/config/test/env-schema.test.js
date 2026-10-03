/**
 * Unit tests for @omega.js/config's env schema — the ONE inventory of the
 * env keys OMEGA needs (#581): who owns each, which targets read it, whether
 * a default function mints it, whether it is required, and what it does.
 *
 * The manager's three lanes (the generated-key mint, the canonical .env
 * grouping, the disperse composition) and the backend's env reader all derive
 * from this list, so the shape is pinned here and the inventory carries a
 * golden floor: every key those lanes carried before the schema existed must
 * still resolve to an entry.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const configIndex = require('../src/index.js');

const {
  ENV_SCHEMA, ENV_GROUPS, TARGETS, DELIVERY_MODES,
  envSchemaEntry, envKeysForTarget, envKeysByGroup, envFileGroups, generatedEnvKeys, baseMissingKeys,
} = configIndex;

// The union of the three manager lanes as they stood before the schema
// (lib/env-generated.js, lib/env-order.js's groups, the retired disperse
// service's ENV_MAP) — a
// floor, not a ceiling: the schema may grow, never silently shrink.
const MANAGER_LANE_KEYS = [
  'OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY',
  'GH_TOKEN', 'CLOUDFLARE_TOKEN',
  'NAMECHEAP_USERNAME', 'NAMECHEAP_API_KEY',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  // #893 retired RECAPTCHA_SITE_KEY outright: a public site key is config
  // (captcha.providers.recaptcha.siteKey), so the floor drops it with the schema
  'RECAPTCHA_SECRET_KEY',
  'META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN',
  'SENTRY_AUTH_TOKEN',
  'SENDGRID_API_KEY', 'BEEHIIV_API_KEY',
  'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'CHARGEBEE_API_KEY',
  'SLAPFORM_SERVICE_ACCOUNT', 'CHATSY_SERVICE_ACCOUNT', 'REPLYIFY_SERVICE_ACCOUNT', 'SERVER_SERVICE_ACCOUNT', 'MRLOGO_SERVICE_ACCOUNT',
  'APPLE_API_ISSUER', 'APPLE_API_KEY_ID', 'APPLE_TEAM_ID',
  'OMEGA_FONTAWESOME_ROOT',
  'ACCOUNT_PASSWORD_SEED', 'CSC_KEY_PASSWORD', 'VAPID_PRIVATE_KEY',
  'GOOGLE_ANALYTICS_SECRET_WEB', 'GOOGLE_ANALYTICS_SECRET_BACKEND',
  'GOOGLE_ANALYTICS_SECRET_DESKTOP', 'GOOGLE_ANALYTICS_SECRET_EXTENSION',
  'GOOGLE_ANALYTICS_SECRET_MOBILE',
  // #639 retired the OMEGA_-prefixed AI twins outright — a DELIBERATE shrink
  // (one key per provider), so the floor drops them with it
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  // #636 removed COINBASE_API_KEY and APOLLO_API_KEY outright — a dead pair
  // no reader ever existed for, so the floor drops them with the schema
  'NEVERBOUNCE_API_KEY', 'ZEROBOUNCE_API_KEY',
];

// What disperse composed into targets/backend/.env before the schema — the
// derivation must still carry every one of them.
const BACKEND_COMPOSED_FLOOR = [
  'GH_TOKEN',
  'OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'CHARGEBEE_API_KEY',
  'META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN',
  'CLOUDFLARE_TOKEN', 'RECAPTCHA_SECRET_KEY',
  'SENDGRID_API_KEY', 'BEEHIIV_API_KEY', 'NEVERBOUNCE_API_KEY', 'ZEROBOUNCE_API_KEY',
  'UNSUBSCRIBE_HMAC_KEY',
];

// ─── The two "when" facts ───

const APPLE = { certificates: { providers: { apple: { bundleIdPrefix: 'com.acme' } } } };
const signing = (value) => ({ platforms: { windows: { signing: value } } });
const cloudSigning = (provider) => signing({ strategy: 'cloud', cloud: { provider } });
const GA_ID = { analytics: { providers: { google: { id: 'G-ACME123' } } } };
const DESKTOP = { targets: { desktop: { type: 'desktop' } } };
const desktopCloud = (provider) => ({ ...DESKTOP, ...cloudSigning(provider) });

// Each ruled key, a config its rule holds on, and one beside it that it does
// not hold on: the rule's meaning is pinned, never its written form.
const REQUIRED_WHEN = {
  RECAPTCHA_SECRET_KEY: [{ captcha: { providers: { recaptcha: { siteKey: '6Lc-abc' } } } }, { captcha: { providers: { recaptcha: {} } } }],
  SENTRY_AUTH_TOKEN: [{ monitoring: { providers: { sentry: { dsn: 'https://public@o0.ingest.sentry.io/0' } } } }, { monitoring: { providers: { sentry: { org: 'acme' } } } }],
  // The signing sets: a brand that declares Apple signing owes the mac set,
  // and each Windows strategy owes ITS credentials and no other's. A desktop
  // target ships the snap and signs with self-hosted unless its config says otherwise
  APPLE_API_ISSUER: [APPLE, {}],
  APPLE_API_KEY_ID: [APPLE, {}],
  APPLE_TEAM_ID: [APPLE, {}],
  CSC_LINK: [APPLE, {}],
  APPLE_API_KEY: [APPLE, {}],
  CSC_KEY_PASSWORD: [APPLE, {}],
  WIN_EV_TOKEN_PATH: [DESKTOP, { ...DESKTOP, ...cloudSigning('azure') }],
  WIN_CSC_KEY_PASSWORD: [DESKTOP, { ...DESKTOP, ...cloudSigning('azure') }],
  AZURE_TENANT_ID: [desktopCloud('azure'), desktopCloud('sslcom')],
  AZURE_CLIENT_ID: [desktopCloud('azure'), desktopCloud('sslcom')],
  AZURE_CLIENT_SECRET: [desktopCloud('azure'), desktopCloud('sslcom')],
  AZURE_TRUSTED_SIGNING_ENDPOINT: [desktopCloud('azure'), desktopCloud('sslcom')],
  SSLCOM_USERNAME: [desktopCloud('sslcom'), desktopCloud('digicert')],
  SSLCOM_PASSWORD: [desktopCloud('sslcom'), desktopCloud('digicert')],
  SSLCOM_CREDENTIAL_ID: [desktopCloud('sslcom'), desktopCloud('digicert')],
  DIGICERT_API_KEY: [desktopCloud('digicert'), desktopCloud('azure')],
  DIGICERT_KEYPAIR_ALIAS: [desktopCloud('digicert'), desktopCloud('azure')],
  SNAPCRAFT_STORE_CREDENTIALS: [DESKTOP, { ...DESKTOP, platforms: { linux: { formats: { snap: false } } } }],
  GOOGLE_ANALYTICS_SECRET_WEB: [GA_ID, { analytics: { providers: { google: {} } } }],
  GOOGLE_ANALYTICS_SECRET_BACKEND: [GA_ID, { analytics: { providers: { google: {} } } }],
  GOOGLE_ANALYTICS_SECRET_DESKTOP: [GA_ID, { analytics: { providers: { google: {} } } }],
  GOOGLE_ANALYTICS_SECRET_EXTENSION: [GA_ID, { analytics: { providers: { google: {} } } }],
};

// ─── The Windows cloud-signing keys: owed only by a shipped, cloud-signed installer ───

const AZURE_KEYS = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT'];
const SSLCOM_KEYS = ['SSLCOM_USERNAME', 'SSLCOM_PASSWORD', 'SSLCOM_CREDENTIAL_ID'];
const CLOUD_KEYS = [...AZURE_KEYS, ...SSLCOM_KEYS, 'DIGICERT_API_KEY', 'DIGICERT_KEYPAIR_ALIAS'];
const SELF_HOSTED_KEYS = ['WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD'];
const owed = (config, keys) => keys.filter((name) => envSchemaEntry(name).requiredWhen(config));

module.exports = defineCases({
  type: 'group',
  description: 'env-schema',
  tests: [
    {
      name: 'every entry carries the full rule shape',
      run: (ctx) => {
        const groupIds = new Set(ENV_GROUPS.map((group) => group.id));

        for (const entry of ENV_SCHEMA) {
          const where = entry.name || String(entry.match);

          ctx.expect(entry.name || entry.match instanceof RegExp, `${where}: needs a name or a match pattern`).toBeTruthy();
          if (entry.name) {
            ctx.expect(entry.name, `${where}: env names are SCREAMING_SNAKE_CASE`).toMatch(/^[A-Z][A-Z0-9_]*$/);
          }
          ctx.expect(typeof entry.owner, `${where}: owner service`).toBe('string');
          ctx.expect(entry.owner.length > 0, `${where}: owner service is not empty`).toBeTruthy();
          ctx.expect(Array.isArray(entry.targets), `${where}: targets array`).toBeTruthy();
          for (const target of entry.targets) {
            ctx.expect(TARGETS.includes(target), `${where}: ${target} is a known target`).toBeTruthy();
          }
          ctx.expect(groupIds.has(entry.group), `${where}: group "${entry.group}" is declared in ENV_GROUPS`).toBeTruthy();
          ctx.expect(typeof entry.secret, `${where}: secret flag`).toBe('boolean');
          ctx.expect(typeof entry.required, `${where}: required flag`).toBe('boolean');
          ctx.expect(typeof entry.description, `${where}: description`).toBe('string');
          ctx.expect(entry.description.length > 0, `${where}: description is not empty`).toBeTruthy();

          if ('generated' in entry) {
            ctx.expect(typeof entry.generated, `${where}: generated is the function that mints the value`).toBe('function');
          }
          if ('default' in entry) {
            ctx.expect(typeof entry.default, `${where}: a static default is a string`).toBe('string');
            ctx.expect(!('generated' in entry), `${where}: a key is minted or defaulted, never both`).toBeTruthy();
          }
          // A required key must be one OMEGA can produce — a third-party secret
          // nobody can mint would refuse every boot until it is pasted in
          if (entry.required) {
            ctx.expect('generated' in entry || 'default' in entry, `${where}: a required key needs a generator or a default`).toBeTruthy();
          }
          // Both "when" facts are written with the named rules, so each is a function of the config
          for (const field of ['requiredWhen', 'askedWhen']) {
            if (field in entry) {
              ctx.expect(typeof entry[field], `${where}: ${field} is a rule from env-when.js`).toBe('function');
            }
          }
        }
      },
    },

    {
      name: 'names are unique and every group is used',
      run: (ctx) => {
        const names = ENV_SCHEMA.filter((entry) => entry.name).map((entry) => entry.name);
        ctx.expect(new Set(names).size, 'no key appears twice').toBe(names.length);

        const used = new Set(ENV_SCHEMA.map((entry) => entry.group));
        const unused = ENV_GROUPS.filter((group) => !used.has(group.id)).map((group) => group.id);
        ctx.expect(unused, 'every declared group owns at least one key').toEqual([]);
      },
    },

    // A key with no reader is no inventory entry, and a public value lives in
    // config (docs/shared/config.md "Config or env?"): the six public ids are rows
    // in @omega.js/manager's migrate table, never schema entries.
    {
      name: 'the public identifiers are gone from the env schema (#893)',
      run: (ctx) => {
        const moved = {
          CHROME_EXTENSION_ID: 'extension',
          FIREFOX_EXTENSION_ID: 'extension',
          EDGE_PRODUCT_ID: 'extension',
          RECAPTCHA_SITE_KEY: 'web',
          PAYPAL_CLIENT_ID: 'backend',
          CHARGEBEE_SITE: 'backend',
        };

        for (const [name, target] of Object.entries(moved)) {
          ctx.expect(envSchemaEntry(name), `${name} lives in config now, not the env schema`).toBe(undefined);
          ctx.expect(!envKeysForTarget(target).includes(name), `${name} must not compose into the ${target} env`).toBeTruthy();
        }
      },
    },

    {
      name: 'the dead keys are gone — no reader, no entry (#636)',
      run: (ctx) => {
        for (const name of ['COINBASE_API_KEY', 'APOLLO_API_KEY']) {
          ctx.expect(envSchemaEntry(name), `${name} has no reader anywhere — it must not be declared`).toBe(undefined);
          ctx.expect(!envKeysForTarget('backend').includes(name), `${name} must not compose into targets/backend/.env`).toBeTruthy();
        }
      },
    },

    // #642 — the Coinbase Commerce provider's one credential. Secret, backend-only,
    // optional: a brand that sells no crypto never owes it.
    {
      name: 'COINBASE_COMMERCE_API_KEY is declared like its payment siblings (#642)',
      run: (ctx) => {
        const entry = envSchemaEntry('COINBASE_COMMERCE_API_KEY');

        ctx.expect(entry, 'the Coinbase Commerce key must be declared — the backend reads it').toBeTruthy();
        ctx.expect(entry.group).toBe('payment');
        ctx.expect(entry.secret, 'the API key is the whole credential — it never reaches config').toBe(true);
        ctx.expect(entry.required).toBe(false);
        ctx.expect(envKeysForTarget('backend').includes('COINBASE_COMMERCE_API_KEY'), 'it composes into targets/backend/.env').toBeTruthy();
      },
    },

    {
      name: 'every key the manager lanes carried resolves to an entry',
      run: (ctx) => {
        const missing = MANAGER_LANE_KEYS.filter((name) => !envSchemaEntry(name));
        ctx.expect(missing, `keys with no schema entry: ${missing.join(', ')}`).toEqual([]);
      },
    },

    {
      name: 'the backend composition still carries every key disperse composed',
      run: (ctx) => {
        const composed = envKeysForTarget('backend');
        const missing = BACKEND_COMPOSED_FLOOR.filter((name) => !composed.includes(name));
        ctx.expect(missing, `keys dropped from the backend composition: ${missing.join(', ')}`).toEqual([]);
      },
    },

    {
      name: 'generatedEnvKeys(): name → a function that mints a fresh value',
      run: (ctx) => {
        const generated = generatedEnvKeys();

        ctx.expect(Object.keys(generated)).toEqual(['OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY']);

        for (const [name, mint] of Object.entries(generated)) {
          const value = mint();
          ctx.expect(typeof value, `${name} mints a string`).toBe('string');
          ctx.expect(value.length >= 32, `${name} mints key material, not a token`).toBeTruthy();
          ctx.expect(mint(), `${name} mints a fresh value every call`).not.toBe(value);
        }
      },
    },

    {
      name: 'baseMissingKeys(): the backend refuses to run without the minted four',
      run: (ctx) => {
        const owed = (target) => baseMissingKeys({}, { target, verb: 'start' }).map((row) => row.key);

        ctx.expect(owed('backend').sort()).toEqual(['OMEGA_ADMIN_KEY', 'OMEGA_NAMESPACE', 'OMEGA_WEBHOOK_KEY', 'UNSUBSCRIBE_HMAC_KEY']);
        // Nothing else is required: a brand with no Stripe account boots fine
        ctx.expect(owed('web')).toEqual([]);
      },
    },

    {
      name: 'requiredEnvKeys is gone: no second list of what every brand owes',
      run: (ctx) => {
        ctx.expect('requiredEnvKeys' in configIndex).toBe(false);
        ctx.expect('requiredEnvKeys' in require('../src/env-schema.js')).toBe(false);
      },
    },

    {
      name: 'GH_TOKEN names every target that consumes it, the extension included (#883)',
      run: (ctx) => {
        // The extension publish uploads its zips to `<brand.id>-releases`, a repo the
        // run does not own, so the extension is a first-class consumer: declared here
        // and delivered `ci`, never borrowed from a sibling target's secret push.
        ctx.expect(envSchemaEntry('GH_TOKEN').targets).toEqual(['web', 'backend', 'desktop', 'extension']);
        ctx.expect(envSchemaEntry('GH_TOKEN').delivery).toEqual({ web: 'ci', backend: 'env', desktop: 'ci', extension: 'ci' });
      },
    },

    {
      name: 'envSchemaEntry(): unknown names miss, dynamic families match their pattern',
      run: (ctx) => {
        ctx.expect(envSchemaEntry('NOT_A_REAL_KEY')).toBe(undefined);
        ctx.expect(envSchemaEntry('GH_TOKEN').owner).toBe('repo');

        const connections = envSchemaEntry('CONNECTIONS_GOOGLE_CLIENT_SECRET');
        ctx.expect(connections, 'the connection client family resolves through its pattern').toBeTruthy();
        ctx.expect(connections.secret).toBe(true);
      },
    },

    {
      name: 'the payment secrets carry no dev twin and no live shape — the environment overlay replaced them (#586)',
      run: (ctx) => {
        // Ruled 2026-08-26: the `<KEY>_DEV` twin system is replaced, before it
        // shipped, by `.env.<environment>` files overlaying the base `.env` — the
        // widespread standard. Every key is equal there, and the values are TRUSTED:
        // no live-shape guard, no payment-specific rule, no key with special
        // treatment. Both entry fields are gone with the mechanism.
        ctx.expect(ENV_SCHEMA.filter((entry) => 'devOf' in entry || 'liveShape' in entry)).toEqual([]);

        for (const base of ['STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'CHARGEBEE_API_KEY']) {
          ctx.expect(envSchemaEntry(base), `${base} is still the one declared key`).toBeTruthy();
          ctx.expect(envSchemaEntry(`${base}_DEV`), `${base}_DEV must not be declared`).toBe(undefined);
          ctx.expect(!envKeysForTarget('backend').includes(`${base}_DEV`), `${base}_DEV must not compose into targets/backend/.env`).toBeTruthy();
          ctx.expect(!envKeysByGroup().payment.includes(`${base}_DEV`), `${base}_DEV must not render into a brand .env`).toBeTruthy();
        }
      },
    },

    {
      name: 'envKeysByGroup(): file groups render, runtime keys never reach a brand .env',
      run: (ctx) => {
        const byGroup = envKeysByGroup();

        ctx.expect(byGroup.omega).toEqual(['OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY']);

        // The runtime group is the backend's own resolution lanes (config-derived
        // values, disperse's per-target stream secret, the developer's shell) — a
        // brand never hand-writes them, so they are neither rendered nor composed
        const runtime = ENV_GROUPS.find((group) => group.id === 'runtime');
        ctx.expect(runtime.file).toBe(false);
        ctx.expect(byGroup.runtime.includes('GOOGLE_ANALYTICS_SECRET')).toBeTruthy();
        ctx.expect(!envKeysForTarget('backend').includes('GOOGLE_ANALYTICS_SECRET')).toBeTruthy();
      },
    },

    {
      name: 'one AI key per provider — the OMEGA_-prefixed twins are gone',
      run: (ctx) => {
        // #639: the legacy split (a company-wide OMEGA_* fallback beside the
        // brand's bare key) is retired. The company-wide value lives in the COMPANY
        // layer of the .env cascade under the SAME name, never a second key.
        ctx.expect(envSchemaEntry('OMEGA_OPENAI_API_KEY')).toBe(undefined);
        ctx.expect(envSchemaEntry('OMEGA_ANTHROPIC_API_KEY')).toBe(undefined);

        for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
          const entry = envSchemaEntry(name);
          ctx.expect(entry.owner, `${name} is the backend framework's own key`).toBe('backend');
          ctx.expect(entry.secret).toBe(true);
          ctx.expect(entry.required, `${name} is optional — nobody mints it`).toBe(false);
          ctx.expect(envKeysForTarget('backend').includes(name), `${name} composes into the backend .env`).toBeTruthy();
        }
      },
    },

    {
      name: 'OMEGA_LICENSE_KEY travels CLI → server at deploy, and never into an artifact (#320)',
      run: (ctx) => {
        const entry = envSchemaEntry('OMEGA_LICENSE_KEY');

        ctx.expect(entry, 'the deploy-time license check reads it, so the schema declares it').toBeTruthy();
        ctx.expect(entry.group).toBe('license');
        ctx.expect(entry.secret).toBe(true);
        ctx.expect(entry.required, 'keyless is a supported state — attribution shown, payments gated').toBe(false);
        ctx.expect('generated' in entry, 'omegajs.dev issues it; OMEGA cannot mint it').toBe(false);

        // Every delivery is 'ci': ALL FOUR targets deploy from an Actions runner now
        // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)), so the check
        // runs where the deploy runs and the key is in that runner's env, nothing else.
        ctx.expect(entry.targets).toEqual(['web', 'backend', 'desktop', 'extension']);
        ctx.expect(entry.delivery).toEqual({ web: 'ci', backend: 'ci', desktop: 'ci', extension: 'ci' });

        // `ci` is the WHOLE of what keeps it out of the functions upload: an 'env'
        // delivery would compose the key into dist/.env and ship it INSIDE the
        // deployed artifact, which is the one thing it must not do. The two lanes
        // that write a backend .env both read that declaration (env-delivery's
        // envFileKeys for the workflow's writer, artifactEnvValues for the stage).
        ctx.expect(entry.delivery.backend, 'the runner env carries it for the check, the artifact never does').toBe('ci');

        ctx.expect('publicAtRest' in entry, 'nothing bakes it — a baked license key is a license key anyone can copy').toBe(false);
      },
    },

    {
      name: 'OMEGA_LICENSE_STATUS is the deploy-written verdict, never a brand-written key (#320)',
      run: (ctx) => {
        const entry = envSchemaEntry('OMEGA_LICENSE_STATUS');

        ctx.expect(entry, 'the backend payment gate reads it, so the env reader must know it').toBeTruthy();
        ctx.expect(entry.group, 'a backend deploy WRITES it into dist/.env; no human ever types it').toBe('runtime');
        ctx.expect(entry.secret, 'a computed verdict, not a credential').toBe(false);
        ctx.expect(entry.required, 'absent = keyless-dev, exactly today\'s behavior').toBe(false);
        ctx.expect(entry.targets).toEqual(['backend']);
        ctx.expect('delivery' in entry, 'no runner, no bake — the deploy composes the value itself').toBe(false);

        // The runtime group renders no file line, so a brand .env can never carry it
        // and the composer can never deliver one down from the brand layer.
        ctx.expect(!envKeysForTarget('backend').includes('OMEGA_LICENSE_STATUS')).toBeTruthy();
      },
    },

    // ─── Delivery: the composer's filter (#678) ───

    {
      name: 'deliverAs: the per-target GA4 secrets rename on delivery, and only there',
      run: (ctx) => {
        const renamed = ENV_SCHEMA.filter((entry) => entry.deliverAs);

        ctx.expect(renamed.map((entry) => entry.name)).toEqual([
          'GOOGLE_ANALYTICS_SECRET_WEB',
          'GOOGLE_ANALYTICS_SECRET_BACKEND',
          'GOOGLE_ANALYTICS_SECRET_DESKTOP',
          'GOOGLE_ANALYTICS_SECRET_EXTENSION',
          'GOOGLE_ANALYTICS_SECRET_MOBILE',
        ]);

        for (const entry of renamed) {
          ctx.expect(entry.deliverAs, `${entry.name}: delivers under the runtime name`).toBe('GOOGLE_ANALYTICS_SECRET');
          ctx.expect(entry.targets.length, `${entry.name}: names exactly the target whose stream it is`).toBe(1);
          ctx.expect(entry.name, `${entry.name}: the suffix IS the target it delivers to`).toBe(`GOOGLE_ANALYTICS_SECRET_${entry.targets[0] === 'web' ? 'WEB' : entry.targets[0].toUpperCase()}`);
        }
      },
    },

    {
      name: 'the connection client family is a FILE key: a human writes it into the brand .env (#678)',
      run: (ctx) => {
        const entry = envSchemaEntry('CONNECTIONS_GOOGLE_CLIENT_ID');

        ctx.expect(entry, 'the family resolves through its pattern').toBeTruthy();
        ctx.expect(entry.targets).toEqual(['backend']);
        ctx.expect(entry.group, 'it lives in a file group, so the composer delivers it').toBe('backend-services');
        ctx.expect(envFileGroups().some((group) => group.id === entry.group)).toBe(true);
        ctx.expect(entry.description, 'nothing resolves it at runtime any more').not.toMatch(/runtime/i);
      },
    },

    // ─── Delivery + the presence rules (#627 / #626) ───

    {
      name: 'every declared delivery is a known mode, for a target the entry names',
      run: (ctx) => {
        for (const entry of ENV_SCHEMA) {
          const where = entry.name || String(entry.match);
          if (!('delivery' in entry)) continue;

          ctx.expect(typeof entry.delivery, `${where}: delivery is an object keyed by target`).toBe('object');
          ctx.expect(Object.keys(entry.delivery).length > 0, `${where}: an empty delivery says nothing — omit it instead`).toBeTruthy();

          for (const [target, mode] of Object.entries(entry.delivery)) {
            ctx.expect(entry.targets.includes(target), `${where}: delivers to ${target}, so ${target} must be one of its targets`).toBeTruthy();
            ctx.expect(DELIVERY_MODES.includes(mode), `${where}: "${mode}" is not one of ${DELIVERY_MODES.join('/')}`).toBeTruthy();
            // A bake ends up readable by anyone who unpacks the app
            if (mode === 'bake') {
              ctx.expect(entry.publicAtRest, `${where}: bakes into the ${target} artifact, so it must declare publicAtRest`).toBe(true);
            }
          }
        }
      },
    },

    {
      name: 'publicAtRest is declared only where something actually bakes',
      run: (ctx) => {
        for (const entry of ENV_SCHEMA) {
          if (!('publicAtRest' in entry)) continue;
          const where = entry.name || String(entry.match);

          ctx.expect(entry.publicAtRest, `${where}: publicAtRest is a declaration, never a false`).toBe(true);
          ctx.expect(Object.values(entry.delivery || {}).includes('bake'), `${where}: nothing bakes it — drop the declaration`).toBeTruthy();
        }

        // The sanctioned baked keys, and only those
        const baked = ENV_SCHEMA.filter((entry) => entry.publicAtRest).map((entry) => entry.name);
        ctx.expect(baked).toEqual(['GOOGLE_ANALYTICS_SECRET_DESKTOP', 'GOOGLE_ANALYTICS_SECRET_EXTENSION']);
      },
    },

    {
      name: 'every live target declares how each key reaches it',
      run: (ctx) => {
        const fileGroups = new Set(envFileGroups().map((group) => group.id));
        // Mobile is PARKED (no packages/mobile, no delivery lane to declare), so it
        // is the one target name excluded here (#819).
        const liveTargets = TARGETS.filter((target) => target !== 'mobile');

        for (const entry of ENV_SCHEMA) {
          if (!fileGroups.has(entry.group)) continue;

          for (const target of liveTargets) {
            if (!entry.targets.includes(target)) continue;
            const where = entry.name || String(entry.match);
            ctx.expect(entry.delivery && entry.delivery[target], `${where}: names ${target} but never says how it gets there`).toBeTruthy();
          }
        }

        // The backend is the one target that ships an .env with its artifact, so
        // `env` is how a brand key reaches it. Its `ci` deliveries are the two keys
        // the RUNNER needs and the artifact never does
        // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): the deploy
        // credential, and the license key the deploy checks before it stages.
        const backendModes = new Set(ENV_SCHEMA.filter((entry) => entry.delivery?.backend).map((entry) => entry.delivery.backend));
        ctx.expect([...backendModes].sort()).toEqual(['ci', 'env']);
        ctx.expect(ENV_SCHEMA.filter((entry) => entry.delivery?.backend === 'ci').map((entry) => entry.name)).toEqual(['OMEGA_LICENSE_KEY', 'OMEGA_SERVICE_ACCOUNT_JSON']);
      },
    },

    {
      name: 'the nine Windows cloud-signing keys the desktop workflow injects are declared (#627)',
      run: (ctx) => {
        const added = [
          'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT',
          'SSLCOM_USERNAME', 'SSLCOM_PASSWORD', 'SSLCOM_CREDENTIAL_ID',
          'DIGICERT_API_KEY', 'DIGICERT_KEYPAIR_ALIAS',
        ];

        for (const name of added) {
          const entry = envSchemaEntry(name);
          ctx.expect(entry, `${name}: the desktop workflow consumes it, so the schema declares it`).toBeTruthy();
          ctx.expect(entry.group, `${name}: renders beside the other signing keys`).toBe('desktop-publishing');
          ctx.expect(entry.targets).toEqual(['desktop']);
          ctx.expect(entry.secret).toBe(true);
          ctx.expect(entry.required, `${name}: only a brand on that signing provider ever sets it`).toBe(false);
          ctx.expect(entry.delivery).toEqual({ desktop: 'ci' });
        }

        ctx.expect(added.every((name) => envKeysByGroup()['desktop-publishing'].includes(name))).toBeTruthy();
      },
    },

    {
      name: 'requiredWhen: exactly the 24 keys a config can make required, each on its own setting',
      run: (ctx) => {
        const ruled = ENV_SCHEMA.filter((entry) => entry.requiredWhen);

        ctx.expect(ruled.map((entry) => entry.name).sort()).toEqual(Object.keys(REQUIRED_WHEN).sort());

        for (const entry of ruled) {
          const [holding, beside] = REQUIRED_WHEN[entry.name];
          ctx.expect(entry.requiredWhen(holding), `${entry.name}: holds on its setting`).toBe(true);
          ctx.expect(entry.requiredWhen(beside), `${entry.name}: does not hold beside it`).toBe(false);
          ctx.expect(entry.requiredWhen({}), `${entry.name}: one direction only, a config that says nothing owes nothing`).toBe(false);
          ctx.expect(entry.required, `${entry.name}: a conditional requirement is never an unconditional one`).toBe(false);
        }

        // The parked mobile target carries NO rule: MAM has no mint, no delivery
        // and no target, so a rule on its key could only warn, forever.
        ctx.expect(envSchemaEntry('GOOGLE_ANALYTICS_SECRET_MOBILE').requiredWhen).toBe(undefined);
      },
    },

    {
      name: 'requiredWhen: a default desktop format owes its keys until it is turned off, and only on a desktop brand',
      run: (ctx) => {
        const snap = envSchemaEntry('SNAPCRAFT_STORE_CREDENTIALS').requiredWhen;
        const selfHosted = ['WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD'].map((name) => [name, envSchemaEntry(name).requiredWhen]);

        ctx.expect(snap({ ...DESKTOP, platforms: { linux: false } }), 'linux turned off').toBe(false);
        ctx.expect(snap({ platforms: { linux: { formats: { snap: {} } } } }), 'a declared snap with no desktop target').toBe(false);

        for (const [name, rule] of selfHosted) {
          ctx.expect(rule({ ...DESKTOP, ...signing({ strategy: 'self-hosted' }) }), `${name}: the strategy written out`).toBe(true);
          ctx.expect(rule({ ...DESKTOP, platforms: { windows: false } }), `${name}: windows turned off`).toBe(false);
          ctx.expect(rule({ ...DESKTOP, platforms: { windows: { formats: { nsis: false } } } }), `${name}: the installer turned off`).toBe(false);
          ctx.expect(rule(signing({ strategy: 'self-hosted' })), `${name}: no desktop target`).toBe(false);
        }
      },
    },

    {
      name: 'cloud signing case 1: a desktop target on the cloud strategy with Azure owes the four Azure keys and no other provider\'s',
      run: (ctx) => {
        ctx.expect(owed(desktopCloud('azure'), CLOUD_KEYS)).toEqual(AZURE_KEYS);
      },
    },

    {
      name: 'cloud signing case 2: the installer turned off owes no cloud key',
      run: (ctx) => {
        const config = { ...DESKTOP, platforms: { windows: { formats: { nsis: false }, signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } };
        ctx.expect(owed(config, CLOUD_KEYS)).toEqual([]);
      },
    },

    {
      name: 'cloud signing case 3: Windows turned off owes no cloud key',
      run: (ctx) => {
        // The provider stays written in the shared block; the target turns Windows off
        const config = { ...cloudSigning('azure'), targets: { desktop: { type: 'desktop', platforms: { windows: false } } } };
        ctx.expect(owed(config, CLOUD_KEYS)).toEqual([]);
      },
    },

    {
      name: 'cloud signing case 4: a provider written without the cloud strategy owes no cloud key, and the self-hosted pair instead',
      run: (ctx) => {
        for (const strategy of [undefined, 'self-hosted']) {
          const config = { ...DESKTOP, ...signing({ ...(strategy ? { strategy } : {}), cloud: { provider: 'azure' } }) };
          ctx.expect(owed(config, CLOUD_KEYS), `strategy ${strategy}`).toEqual([]);
          ctx.expect(owed(config, SELF_HOSTED_KEYS), `strategy ${strategy}`).toEqual(SELF_HOSTED_KEYS);
        }
      },
    },

    {
      name: 'cloud signing case 5: the cloud strategy and a provider with no desktop target owe no cloud key',
      run: (ctx) => {
        ctx.expect(owed(cloudSigning('azure'), CLOUD_KEYS)).toEqual([]);
        ctx.expect(owed({ ...cloudSigning('azure'), targets: { web: { type: 'web' } } }, CLOUD_KEYS)).toEqual([]);
      },
    },

    {
      name: 'cloud signing case 6: of two desktop targets, the one on the cloud strategy with SSL.com owes the three SSL.com keys',
      run: (ctx) => {
        const config = {
          targets: {
            app: { type: 'desktop' },
            pro: { type: 'desktop', platforms: { windows: { signing: { strategy: 'cloud', cloud: { provider: 'sslcom' } } } } },
          },
        };
        ctx.expect(owed(config, CLOUD_KEYS)).toEqual(SSLCOM_KEYS);
      },
    },

    {
      name: 'cloud signing case 8: no rule in the env schema reads the cloud provider path with chosen',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'env-schema.js'), 'utf8');
        const PROVIDER_PATH = 'platforms.windows.signing.cloud.provider';
        // A name the path is bound to counts as the path itself
        const aliases = [...source.matchAll(/(\w+)\s*=\s*['"`]platforms\.windows\.signing\.cloud\.provider['"`]/g)].map((match) => match[1]);
        const firstArgs = [...source.matchAll(/\bchosen\(\s*([^,)]+)/g)].map((match) => match[1].trim().replace(/^['"`]|['"`]$/g, ''));

        ctx.expect(firstArgs.filter((arg) => arg === PROVIDER_PATH || aliases.includes(arg))).toEqual([]);
      },
    },

    {
      name: 'askedWhen: exactly the keys manage asks a person for, moved in from the manager',
      run: (ctx) => {
        const asked = ENV_SCHEMA.filter((entry) => entry.askedWhen).map((entry) => entry.name);

        // The ship-format keys are not here: their one home is the format table
        ctx.expect(asked.sort()).toEqual([
          'ANTHROPIC_API_KEY',
          'APPLE_API_ISSUER', 'APPLE_API_KEY_ID', 'APPLE_TEAM_ID',
          'BEEHIIV_API_KEY',
          'CHARGEBEE_API_KEY',
          'CHATSY_SERVICE_ACCOUNT',
          'CLOUDFLARE_TOKEN',
          'COINBASE_COMMERCE_API_KEY',
          'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
          'META_ACCESS_TOKEN',
          'NAMECHEAP_API_KEY', 'NAMECHEAP_USERNAME',
          'OPENAI_API_KEY',
          'PAYPAL_CLIENT_SECRET',
          'RECAPTCHA_SECRET_KEY',
          'REPLYIFY_SERVICE_ACCOUNT',
          'SENDGRID_API_KEY',
          'SENTRY_AUTH_TOKEN',
          'SERVER_SERVICE_ACCOUNT',
          'SLAPFORM_SERVICE_ACCOUNT',
          'STRIPE_SECRET_KEY',
          'TIKTOK_ACCESS_TOKEN',
        ]);
      },
    },

    {
      name: 'askedWhen and requiredWhen differ on purpose: the Sentry token is asked before it is required',
      run: (ctx) => {
        const entry = envSchemaEntry('SENTRY_AUTH_TOKEN');
        const chosen = { monitoring: { providers: { sentry: { org: 'acme' } } } };

        // The manager uses the token to create the project the DSN comes from
        ctx.expect(entry.askedWhen(chosen)).toBe(true);
        ctx.expect(entry.requiredWhen(chosen)).toBe(false);
        ctx.expect(entry.askedWhen({}), 'no Sentry chosen, nothing to ask').toBe(false);

        // reCAPTCHA is asked unless turned off, and required once its site key is set
        const recaptcha = envSchemaEntry('RECAPTCHA_SECRET_KEY');
        ctx.expect(recaptcha.askedWhen({ targets: { backend: { type: 'backend' } } })).toBe(true);
        ctx.expect(recaptcha.askedWhen({ captcha: { providers: { recaptcha: { enabled: false } } }, targets: { backend: { type: 'backend' } } })).toBe(false);
      },
    },
  ],
});

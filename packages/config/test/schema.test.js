/**
 * Unit tests for @omega.js/config's schema module — the declared shared
 * sections and the schema paths other packages read.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { SHARED_SECTIONS, BACKEND_PROJECT_TYPES, backendProjectType } = require('../src/index.js');

module.exports = defineCases({
  type: 'group',
  description: 'schema',
  tests: [
    {
      name: 'SHARED_SECTIONS enumerates the disperse-owned sections',
      run: (ctx) => {
        ctx.expect(SHARED_SECTIONS).toEqual(['brand', 'cloud', 'repo', 'edge', 'captcha', 'search', 'forms', 'inbound', 'analytics', 'advertising', 'features', 'payment', 'monitoring', 'connections', 'theme', 'translation']);
      },
    },

    {
      name: 'SHARED_SECTIONS carries the #23 role homes — disperse enumerates them like any other shared section',
      run: (ctx) => {
        for (const section of ['repo', 'edge', 'captcha', 'search', 'forms', 'inbound']) {
          ctx.expect(SHARED_SECTIONS.includes(section), `${section} is a shared section and must be enumerated`).toBeTruthy();
        }
      },
    },

    {
      name: 'advertising schema: role-keyed providers with the inhouse source (ads spec)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const paths = SHARED_SCHEMA.map((entry) => entry.path);

        ctx.expect(paths.includes('advertising.providers.adsense.client')).toBeTruthy();
        ctx.expect(paths.includes('advertising.providers.inhouse.source')).toBeTruthy();
        ctx.expect(paths.includes('company.id'), 'the in-house company source derives its api from the RESOLVED company.url, whose one typed input is company.id (#677)').toBeTruthy();
        for (const slot of ['displaySlot', 'inArticleSlot', 'inFeedSlot', 'multiplexSlot']) {
          ctx.expect(paths.includes(`advertising.providers.adsense.${slot}`), `missing ${slot}`).toBeTruthy();
        }

        // The vendor prefix and the kebab spellings are gone for good (#23/#35)
        ctx.expect(!paths.some((path) => path.includes('google-adsense')), 'no vendor-prefixed provider id survives').toBeTruthy();
        ctx.expect(!paths.some((path) => /^advertising\..*-/.test(path)), 'no kebab-case key survives under advertising').toBeTruthy();
      },
    },

    // #527 — adsense is case 1 of the gating doctrine (docs/shared/config.md):
    // a DATA-bearing feature switches on its data's presence, one polarity and
    // one switch. `client` set = the manager manages the account, the site
    // renders units, ads.txt carries the record; `client` absent = all of it off.
    // The split gates that once lived beside it (`units`, `enabled`) are deleted:
    // a second switch is how a config says "managed but ad-free" to one half of
    // the stack and "serve ads" to the other.
    {
      name: 'advertising: adsense is pure client-presence — no second switch (#527)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const { validateConfig } = require('../src/validate.js');
        const rule = SHARED_SCHEMA.find((entry) => entry.path === 'advertising.providers.adsense.client');

        ctx.expect(rule, 'missing advertising.providers.adsense.client').toBeTruthy();
        ctx.expect(rule.type).toBe('string');
        ctx.expect(rule.required).toBe(false);
        ctx.expect(rule.description, 'the description names the polarity it drives').toMatch(/presence/i);

        for (const gate of ['units', 'enabled']) {
          ctx.expect(SHARED_SCHEMA.find((entry) => entry.path === `advertising.providers.adsense.${gate}`), `advertising.providers.adsense.${gate} is deleted — client presence decides everything`).toBe(undefined);
        }

        // `advertising` stays presence-gated end to end: no adsense rule carries a
        // materialized default, so no brand grows an advertising block (the build's
        // automatic vert placements key on `site.advertising` existing at all).
        for (const adsenseRule of SHARED_SCHEMA.filter((entry) => entry.path.startsWith('advertising.'))) {
          ctx.expect(Object.prototype.hasOwnProperty.call(adsenseRule, 'default'), `${adsenseRule.path} materializes an advertising block into every brand`).toBe(false);
        }
        ctx.expect(require('../src/defaults.js').schemaDefaults('web').advertising, 'no brand grows an advertising block').toBe(undefined);

        const base = { brand: { id: 'mini', name: 'MiniCo' } };
        ctx.expect(validateConfig({ ...base, advertising: { providers: { adsense: { client: 'ca-pub-1' } } } }).errors, 'the one expressible ON state is a client id').toEqual([]);
      },
    },

    // #642 — the crypto provider is back as a real one, so its config switch owes
    // the schema a rule like every other. Coinbase Commerce's ONLY credential is a
    // secret (COINBASE_COMMERCE_API_KEY), and a secret can never live in config, so
    // there is no case-1 datum to gate on: the switch is an explicit `enabled`,
    // default OFF. Default OFF because an accidental ON puts a Crypto button on the
    // checkout that no key can complete.
    {
      name: 'payment: coinbase is an explicit enabled switch, default OFF (#642)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const { validateConfig } = require('../src/validate.js');

        const rule = SHARED_SCHEMA.find((entry) => entry.path === 'payment.providers.coinbase.enabled');

        ctx.expect(rule, 'missing payment.providers.coinbase.enabled').toBeTruthy();
        ctx.expect(rule.type).toBe('boolean');
        ctx.expect(rule.required).toBe(false);
        ctx.expect(rule.default, 'the polarity is stated by the default').toBe(false);

        // The sibling providers keep their own (case-1) data switches
        const paths = SHARED_SCHEMA.map((entry) => entry.path);
        for (const path of ['payment.providers.stripe.publishableKey', 'payment.providers.paypal.clientId', 'payment.providers.chargebee.site']) {
          ctx.expect(paths.includes(path), `missing ${path}`).toBeTruthy();
        }

        // A brand carrying the block validates clean — it stopped doing so when #636
        // deleted the stub out from under every config that had one
        const base = { brand: { id: 'mini', name: 'MiniCo' } };
        ctx.expect(validateConfig({ ...base, payment: { providers: { coinbase: { enabled: true } } } }).errors, 'an enabled crypto provider is expressible').toEqual([]);
      },
    },

    // #850: the price currency had two homes (targets.web.currency for the pricing
    // page, a bare 'USD' fallback in the backend's order history) and one of them was
    // undeclared. It is a payment fact: every reader now names payment.currency, and
    // the default states the answer they each carried.
    {
      name: 'payment: the price currency is declared, ISO 4217, default USD (#850)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const { validateConfig } = require('../src/validate.js');
        const { schemaDefaults } = require('../src/defaults.js');

        const rule = SHARED_SCHEMA.find((entry) => entry.path === 'payment.currency');

        ctx.expect(rule, 'missing payment.currency').toBeTruthy();
        ctx.expect(rule.type).toBe('string');
        ctx.expect(rule.required).toBe(false);
        ctx.expect(rule.default, "the backend's order history read 'USD' when nothing said otherwise").toBe('USD');
        ctx.expect(rule.description, 'payment.currency documents what it drives').toBeTruthy();

        // The default resolves for every reader, so nothing carries a fallback of its own.
        ctx.expect(schemaDefaults().payment.currency).toBe('USD');

        // A brand naming its own currency validates clean; a non-string bounces.
        const base = { brand: { id: 'mini', name: 'MiniCo' } };
        ctx.expect(validateConfig({ ...base, payment: { currency: 'EUR' } }).errors).toEqual([]);
        ctx.expect(validateConfig({ ...base, payment: { currency: 840 } }).errors
            .some((e) => e.includes('config.payment.currency has wrong type')), 'a currency is the ISO code, never the numeric one').toBeTruthy();
      },
    },

    {
      name: 'monitoring declares every knob the monitoring package resolves (#380)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const paths = SHARED_SCHEMA.map((entry) => entry.path);

        // Undeclared keys pass validation silently, so a typo (scrubemail) would
        // vanish instead of failing — every documented knob is declared here. The
        // knobs hang off the PROVIDER since #425; only `enabled` is role-level.
        ctx.expect(paths.includes('monitoring.enabled'), 'missing monitoring.enabled').toBeTruthy();
        for (const key of ['org', 'dsn', 'environment', 'sampleRate', 'tracesSampleRate', 'scrubEmail', 'attachScreenshot', 'bundlePatterns',
          'replaysSessionSampleRate', 'replaysOnErrorSampleRate']) {
          ctx.expect(paths.includes(`monitoring.providers.sentry.${key}`), `missing monitoring.providers.sentry.${key}`).toBeTruthy();
        }
      },
    },

    {
      name: 'the de-branded role sections are declared (#23)',
      run: (ctx) => {
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
          'repo.owner',
          // the gcp/firebase fold — one cloud home, projectId only under cloud.config
          'cloud.organizationId',
          'cloud.billingAccount',
          'cloud.shared',
          'cloud.supportEmail',
          'cloud.apiSubdomain',
        ];
        for (const path of declared) {
          ctx.expect(paths.includes(path), `missing ${path}`).toBeTruthy();
        }

        ctx.expect(!paths.includes('cloud.projectId'), 'projectId has ONE home: cloud.config.projectId').toBeTruthy();
        // Every config key is camelCase — no hyphen survives anywhere in the schema
        ctx.expect(!paths.some((path) => path.includes('-')), 'no hyphenated config key survives').toBeTruthy();
      },
    },

    // #466 — the web target owns no redirect map any more: a templated redirect is
    // a Cloudflare redirect RULE the edge service reconciles, and an enumerable one
    // is a redirect PAGE. The rules block is where the retired key now points, so
    // it owes the schema a rule of its own.
    {
      name: 'edge.providers.cloudflare.rules.redirect is declared — the templated-redirect home (#466)',
      run: (ctx) => {
        const { SHARED_SCHEMA, TARGET_SCHEMAS } = require('../src/schema.js');
        const { validateConfig } = require('../src/validate.js');

        ctx.expect(!TARGET_SCHEMAS.web.some((entry) => entry.path === 'redirects'), 'targets.web.redirects is gone — the web build answers no redirect config').toBeTruthy();

        const rule = SHARED_SCHEMA.find((entry) => entry.path === 'edge.providers.cloudflare.rules.redirect');
        ctx.expect(rule, 'missing edge.providers.cloudflare.rules.redirect').toBeTruthy();
        ctx.expect(rule.type).toBe('array');
        ctx.expect(rule.description, 'the description names the destination key').toMatch(/targetUrl/);

        const base = { brand: { id: 'mini', name: 'MiniCo' } };
        ctx.expect(validateConfig({
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
          }).errors, 'the DashQR pattern passes as a rules entry').toEqual([]);
        ctx.expect(validateConfig({ ...base, edge: { providers: { cloudflare: { rules: { redirect: { '/c/:id': '/code' } } } } } }).errors.length, 'a map is not a rules list — Cloudflare evaluates them in order').toBe(1);
      },
    },

    // #524 — every key a real brand config carries owes the schema a rule, the
    // #272 precedent: an undeclared key validates only by not being looked at, so
    // a typo in one of these reads as nothing and the validator cannot say what it
    // means. Each one is carried by a converted brand or read by a service.
    {
      name: 'the carried keys brand configs already use are declared (#524)',
      run: (ctx) => {
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
          ctx.expect(rules.has(path), `missing ${path}`).toBeTruthy();
          ctx.expect(rules.get(path).type, `${path} is a ${type}`).toBe(type);
          ctx.expect(rules.get(path).description, `${path} documents what it drives`).toBeTruthy();
          ctx.expect(rules.get(path).required, `${path} stays optional`).toBe(false);
        }

        // A rule is only worth having if it fails loudly on the wrong shape.
        const base = { brand: { id: 'mini', name: 'MiniCo' } };
        ctx.expect(validateConfig({
            brand: { ...base.brand, type: 'Corporation', font: 'CromaSans-ExtraBold', contact: { phone: '+1-555-0100' } },
            cloud: { oauthRedirectsConfigured: true },
            analytics: { providers: { google: { propertyId: '222', accountId: '111' }, meta: { accountId: 'act_1' }, tiktok: { accountId: '7' } } },
            inbound: { chat: { providers: { chatsy: { accountId: 'uid-1' } } } },
          }).errors, 'the shapes real brands carry pass').toEqual([]);
        ctx.expect(validateConfig({ ...base, cloud: { oauthRedirectsConfigured: 'yes' } }).errors
            .some((e) => e.includes('config.cloud.oauthRedirectsConfigured has wrong type')), 'the reconcile flag is a boolean, never a string').toBeTruthy();
        ctx.expect(validateConfig({ ...base, analytics: { providers: { google: { propertyId: 222 } } } }).errors
            .some((e) => e.includes('config.analytics.providers.google.propertyId has wrong type')), 'a GA property id is the string the Admin API returns').toBeTruthy();
      },
    },

    {
      name: 'socials is declared — the block @omega.js/web generates shortlink pages from (#429)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const { validateConfig } = require('../src/validate.js');
        const rule = SHARED_SCHEMA.find((entry) => entry.path === 'socials');

        // Undeclared keys pass validation silently, and this block now drives real
        // output (a redirect page per entry) — it has to be a declared object.
        ctx.expect(rule, 'missing socials').toBeTruthy();
        ctx.expect(rule.type).toBe('object');
        ctx.expect(rule.description, 'the description names the shortlink lane').toMatch(/redirect/);

        const base = { brand: { id: 'mini', name: 'MiniCo' } };
        ctx.expect(validateConfig({ ...base, socials: { twitter: 'somiibo' } }).errors, 'the string form is a handle').toEqual([]);
        ctx.expect(validateConfig({ ...base, socials: { spotify: { handle: 'x', redirect: 'https://open.spotify.com/artist/x' } } }).errors, 'the object form carries the handle plus its own redirect target').toEqual([]);
        ctx.expect(validateConfig({ ...base, socials: ['twitter'] }).errors.length, 'a list is not a socials block').toBe(1);
      },
    },

    // #546: the service switches the manager READS and the schema never declared:
    // an undeclared key validates clean, so `enbaled: false` reads as ON forever
    // and the validator cannot say what the real key does. Both are
    // case 2 of the gating doctrine (docs/shared/config.md): a zero-data feature
    // the framework runs for every brand, switched by `enabled`, default ON, read
    // `!== false` at the service. The repo service left the list in #883: its
    // switch is the PRESENCE of the `repo` block, so there is no `enabled` key to
    // declare or to default.
    {
      name: 'the service enabled switches the manager reads are declared, default ON (#546)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const { validateConfig } = require('../src/validate.js');
        const { schemaDefaults } = require('../src/defaults.js');
        const rules = new Map(SHARED_SCHEMA.map((entry) => [entry.path, entry]));

        const expected = [
          'search.providers.searchConsole.enabled',
          'edge.providers.cloudflare.enabled',
        ];
        for (const path of expected) {
          ctx.expect(rules.has(path), `missing ${path}`).toBeTruthy();
          ctx.expect(rules.get(path).type, `${path} is a boolean`).toBe('boolean');
          ctx.expect(rules.get(path).required, `${path} stays optional`).toBe(false);
          ctx.expect(rules.get(path).default, `${path} defaults ON — the service runs unless told not to`).toBe(true);
          ctx.expect(rules.get(path).description, `${path} documents what false skips`).toBeTruthy();
        }

        // The default is materialized, so a brand's own config carries the answer.
        const defaults = schemaDefaults('web');
        ctx.expect(defaults.search.providers.searchConsole.enabled).toBe(true);
        ctx.expect(defaults.edge.providers.cloudflare.enabled).toBe(true);

        const base = { brand: { id: 'mini', name: 'MiniCo' } };
        ctx.expect(validateConfig({
            ...base,
            search: { providers: { searchConsole: { enabled: false } } },
            edge: { providers: { cloudflare: { enabled: false } } },
          }).errors, 'the OFF state every one of them honors is expressible').toEqual([]);
        ctx.expect(validateConfig({ ...base, search: { providers: { searchConsole: { enabled: 'no' } } } }).errors
            .some((e) => e.includes('config.search.providers.searchConsole.enabled has wrong type')), 'a truthy string would read as ON — the switch is a boolean').toBeTruthy();
      },
    },

    // #553 — the same hole one case over: the manager reads `devlog.enabled ===
    // true` and the schema declared only the parent `devlog` object, so a typo
    // validated clean and the validator could not say what the key does. Devlog is
    // case 3 of the doctrine (docs/shared/config.md): it publishes AI-written posts
    // to the brand's LIVE site, so the literal `true` is the only ON, absence is
    // off, and NO default is materialized — writing a devlog block into every
    // brand's omega.json5 is exactly the invitation a consequential feature must
    // not extend.
    {
      name: 'devlog.enabled is declared — case 3, no materialized default (#553)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const { validateConfig } = require('../src/validate.js');
        const { schemaDefaults } = require('../src/defaults.js');
        const rule = SHARED_SCHEMA.find((entry) => entry.path === 'devlog.enabled');

        ctx.expect(rule, 'missing devlog.enabled').toBeTruthy();
        ctx.expect(rule.type, 'a truthy string must not read as ON').toBe('boolean');
        ctx.expect(rule.required, 'a brand that never devlogs says nothing').toBe(false);
        ctx.expect(!('default' in rule), 'no default — a materialized devlog block would put the switch in every brand\'s config').toBeTruthy();
        ctx.expect(rule.description, 'the description names what true turns on: published devlog posts').toMatch(/publish/i);

        ctx.expect(schemaDefaults('web').devlog, 'nothing devlog lands in the defaults layer').toBe(undefined);

        const base = { brand: { id: 'mini', name: 'MiniCo' } };
        ctx.expect(validateConfig(base).errors, 'absence is valid — and means off').toEqual([]);
        ctx.expect(validateConfig({ ...base, devlog: { enabled: true, providers: { ghostii: { orgs: ['x'] } } } }).errors, 'the opt-in a brand actually writes still validates').toEqual([]);
        ctx.expect(validateConfig({ ...base, devlog: { enabled: 'yes' } }).errors
            .some((e) => e.includes('config.devlog.enabled has wrong type')), 'the switch is a boolean, so the near-miss is loud instead of ON').toBeTruthy();
      },
    },

    // #636 — the per-key sweep found live config paths the schema never declared:
    // the certificates service reads the whole `certificates` block, the captcha
    // and search services WRITE their confirmations back into the brand file, the
    // domain service picks the registrar by the KEY under `domain.providers`, the
    // TikTok mint reads the developer app id (#635), and the client's verts read
    // the advertising fallback + tags. Undeclared means no type, no description,
    // and no validator finding when one of them is misspelled.
    {
      name: 'the paths services read and write back are declared (#636)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const { schemaDefaults } = require('../src/defaults.js');
        const rules = new Map(SHARED_SCHEMA.map((entry) => [entry.path, entry]));

        const expected = {
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
          ctx.expect(rule, `missing ${path}`).toBeTruthy();
          ctx.expect(rule.type, `${path} declares its shape`).toBe(type);
          ctx.expect(rule.required, `${path} is the brand's own answer, never demanded`).toBe(false);
          ctx.expect(rule.description, `${path} documents what it drives`).toBeTruthy();
          // No materialized default: these are owner decisions (the Apple prefix, the
          // registrar) and machine-written confirmations. A default would write the
          // block into every brand's omega.json5: Apple signing declared by a
          // website-only brand, a registrar in a brand that owns no domain.
          ctx.expect(!('default' in rule), `${path} must not materialize a default`).toBeTruthy();
        }

        ctx.expect(schemaDefaults('desktop').certificates, 'only the service switch lands in the defaults layer, never an Apple key').toEqual({ enabled: true });
        ctx.expect(schemaDefaults('web').domain, 'nothing domain lands in the defaults layer').toBe(undefined);
      },
    },

    // #649 — the seven SendGrid unsubscribe (ASM) group ids the backend's send path
    // attaches. They were hardcoded in the backend, so a brand on any other SendGrid
    // account sent with ids that do not exist there. The ids are per ACCOUNT: the
    // campaigns service provisions each group by name and writes its id here.
    {
      name: 'the SendGrid unsubscribe group ids are declared, one row per group (#649)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const { validateConfig } = require('../src/validate.js');
        const { schemaDefaults } = require('../src/defaults.js');
        const rules = new Map(SHARED_SCHEMA.map((entry) => [entry.path, entry]));

        const keys = ['orders', 'hello', 'account', 'marketing', 'security', 'newsletter', 'internal'];

        for (const key of keys) {
          const path = `marketing.campaigns.providers.sendgrid.groups.${key}`;
          const rule = rules.get(path);
          ctx.expect(rule, `missing ${path}`).toBeTruthy();
          ctx.expect(rule.type, `${path} is an ASM group id`).toBe('integer');
          ctx.expect(rule.required, `${path} is machine-written, never demanded`).toBe(false);
          ctx.expect(rule.description, `${path} documents which email it gates`).toBeTruthy();
          // No materialized default: the id belongs to the brand's own SendGrid
          // account, so a written-in answer would be another account's group.
          ctx.expect(!('default' in rule), `${path} must not materialize a default`).toBeTruthy();
        }

        ctx.expect(schemaDefaults('backend').marketing?.campaigns?.providers?.sendgrid?.groups, 'no group ids land in the defaults layer').toBe(undefined);

        const base = { brand: { id: 'mini', name: 'MiniCo' } };
        const groups = Object.fromEntries(keys.map((key, i) => [key, 100 + i]));
        ctx.expect(validateConfig({ ...base, marketing: { campaigns: { providers: { sendgrid: { groups } } } } }).errors, 'the shape the campaigns service writes back validates clean').toEqual([]);
        ctx.expect(validateConfig({ ...base, marketing: { campaigns: { providers: { sendgrid: { groups: { ...groups, orders: '16223' } } } } } }).errors
            .some((e) => e.includes('config.marketing.campaigns.providers.sendgrid.groups.orders has wrong type')), 'a stringified id is caught — SendGrid answers ids as numbers').toBeTruthy();
      },
    },

    // #650 — three @omega.js/client keys that WORK (they reach the client payload
    // and change behaviour: no auth policy, no exit popup, no service worker) and
    // the schema never declared, so every validate run told a brand that turned
    // one off it might be a typo. The client blob stays un-enumerated by design;
    // these three are declared because a brand AUTHORS them.
    {
      name: 'the client keys a brand authors are declared (#650)',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const { validateConfig } = require('../src/validate.js');
        const { schemaDefaults } = require('../src/defaults.js');
        const rules = new Map(SHARED_SCHEMA.map((entry) => [entry.path, entry]));

        for (const path of ['client.auth.config.policy', 'client.exitPopup.enabled', 'client.serviceWorker.enabled']) {
          ctx.expect(rules.has(path), `missing ${path}`).toBeTruthy();
          ctx.expect(rules.get(path).required, `${path} is the brand's own answer, never demanded`).toBe(false);
          ctx.expect(rules.get(path).description, `${path} documents what it drives`).toBeTruthy();
        }

        // The two switches carry @omega.js/client's own polarity (both default ON),
        // so the answer is materialized into the brand file like consent's.
        const defaults = schemaDefaults('web');
        ctx.expect(defaults.client.exitPopup.enabled).toBe(true);
        ctx.expect(defaults.client.serviceWorker.enabled).toBe(true);
        // The policy is a PAGE decision (the auth layouts set it in frontmatter) and
        // its framework answer is "none" — nothing to write into a brand's config.
        ctx.expect(!('default' in rules.get('client.auth.config.policy')), 'the policy must not materialize a default').toBeTruthy();

        const base = { brand: { id: 'mini', name: 'MiniCo' } };
        const { errors, warnings } = validateConfig({
          ...base,
          client: {
            auth: { config: { policy: 'disabled' } },
            exitPopup: { enabled: false },
            serviceWorker: { enabled: false },
          },
        });

        ctx.expect(errors, 'the OFF state each of them honors is expressible').toEqual([]);
        ctx.expect(warnings, 'and a brand that turns them off is not told it may have a typo').toEqual([]);

        ctx.expect(validateConfig({ ...base, client: { auth: { config: { policy: 'authed' } } } }).errors
            .some((e) => e.includes('config.client.auth.config.policy "authed" is not allowed')), 'a near-miss policy is loud instead of silently no-policy').toBeTruthy();
      },
    },

    // ─── backendProjectType (#584) ───

    // #883: the repo block is TWO keys, and the schema is where a second provider
    // lands. `github` (the old identity block), `repo.providers.github.*` and the
    // desktop releases owner/repo are gone from the schema entirely: each is a
    // retired row instead, so a brand still carrying one hears about it.
    {
      name: 'the repo block is provider + owner, and nothing else is declared (#883)',
      run: (ctx) => {
        const { SHARED_SCHEMA, REPO_PROVIDERS } = require('../src/schema.js');
        const rules = new Map(SHARED_SCHEMA.map((entry) => [entry.path, entry]));
        const repoPaths = [...rules.keys()].filter((path) => path === 'repo' || path.startsWith('repo.'));

        ctx.expect(repoPaths).toEqual(['repo', 'repo.provider', 'repo.owner']);
        ctx.expect(rules.get('repo.provider').enum).toEqual(REPO_PROVIDERS);
        ctx.expect(rules.get('repo.provider').type).toBe('string');
        ctx.expect(rules.get('repo.owner').type).toBe('string');

        // The presence-gate exclusion (docs/shared/config.md, Defaults &
        // self-healing): the BLOCK's presence is the switch, so a defaulted provider
        // would say a brand hosts its source somewhere when it declared nothing.
        ctx.expect(!Object.prototype.hasOwnProperty.call(rules.get('repo.provider'), 'default')).toBeTruthy();

        ctx.expect(!rules.has('github'), 'the separate GitHub identity block is retired, not declared').toBeTruthy();
      },
    },

    {
      name: 'hosting is declared on the WEB target only (#883)',
      run: (ctx) => {
        const { TARGET_SCHEMAS, HOSTING_PROVIDERS } = require('../src/schema.js');
        const web = new Map(TARGET_SCHEMAS.web.map((entry) => [entry.path, entry]));

        ctx.expect(web.has('hosting')).toBeTruthy();
        ctx.expect(web.get('hosting.provider').enum).toEqual(HOSTING_PROVIDERS);

        for (const [type, rules] of Object.entries(TARGET_SCHEMAS)) {
          if (type === 'web') continue;
          ctx.expect(!rules.some((rule) => rule.path === 'hosting' || rule.path.startsWith('hosting.')), `${type} declares no hosting key: only a web target has a built site to serve`).toBeTruthy();
        }
      },
    },

    {
      name: 'the desktop releases block is a presence switch, with no repo to name (#883)',
      run: (ctx) => {
        const { TARGET_SCHEMAS } = require('../src/schema.js');
        const paths = TARGET_SCHEMAS.desktop.map((rule) => rule.path);

        ctx.expect(paths.includes('releases')).toBeTruthy();
        ctx.expect(paths.includes('releases.enabled')).toBeTruthy();
        ctx.expect(!paths.includes('releases.owner'), 'the releases repo derives: `<brand.id>-releases` under repo.owner').toBeTruthy();
        ctx.expect(!paths.includes('releases.repo'), 'the releases repo derives: `<brand.id>-releases` under repo.owner').toBeTruthy();
      },
    },

    // #911: the schema was behind the desktop runtime. Every key the annotated
    // default carries (plus omega.authPersistence, which the client bridge reads)
    // owes a rule, so a typo in one of them is loud again instead of passing as a
    // feature nobody declared.
    {
      name: 'the desktop target declares every key its runtime reads (#911)',
      run: (ctx) => {
        const { TARGET_SCHEMAS, SHARED_SCHEMA } = require('../src/schema.js');
        const paths = new Set(TARGET_SCHEMAS.desktop.map((rule) => rule.path));

        for (const key of [
          'omega.authPersistence',
          'app.appId',
          'app.productName',
          'app.copyright',
          'app.languages',
          'app.darkModeSupport',
          'startup.openAtLogin.enabled',
          'startup.openAtLogin.mode',
          'autoUpdate.enabled',
          'autoUpdate.autoDownload',
          'autoUpdate.startupDelayMs',
          'autoUpdate.feedCheckIntervalMs',
          'autoUpdate.idleEvalIntervalMs',
          'autoUpdate.maxAgeMs',
          'remoteConfig.enabled',
          'remoteConfig.url',
        ]) {
          ctx.expect(paths.has(key), `targets.desktop.${key} owes a schema rule`).toBeTruthy();
        }

        // `type` is EVERY target entry's key (#886), so its one home is the shared
        // schema: declaring it per target would be four copies of one contract.
        ctx.expect(SHARED_SCHEMA.some((rule) => rule.path === 'type'), 'every target entry declares its type').toBeTruthy();

        // No beta/update channels exist (Ian 2026-09-02) and nothing in the desktop
        // runtime reads one: `autoUpdate.channel` stays undeclared, and the
        // annotated default no longer offers it.
        ctx.expect(!paths.has('autoUpdate.channel'), 'there are no update channels to declare').toBeTruthy();
      },
    },

    {
      name: 'backendProjectType reads the backend target entry, firebase unless it says custom',
      run: (ctx) => {
        ctx.expect(BACKEND_PROJECT_TYPES).toEqual(['firebase', 'custom']);

        ctx.expect(backendProjectType({ projectType: 'custom' })).toBe('custom');
        ctx.expect(backendProjectType({ projectType: 'firebase' })).toBe('firebase');
        // An absent entry, an empty entry, and a nonsense value all read firebase —
        // the validator is what makes the nonsense loud; the reader never guesses a
        // brand OFF Cloud Functions.
        ctx.expect(backendProjectType(undefined)).toBe('firebase');
        ctx.expect(backendProjectType({})).toBe('firebase');
        ctx.expect(backendProjectType({ projectType: 'render' })).toBe('firebase');
        // It reads a RESOLVED backend config the same way — the target entry's keys
        // land at the top level there.
        ctx.expect(backendProjectType({ brand: { id: 'b' }, projectType: 'custom' })).toBe('custom');
      },
    },

    // Strictness keeps every documented escape hatch open only if it has a rule:
    // an undeclared block fails the load, so each one the desktop reads is typed.
    {
      name: 'the documented override blocks are declared: desktop open subtrees, the backend MCP auth url',
      run: (ctx) => {
        const { TARGET_SCHEMAS } = require('../src/schema.js');
        const rules = new Map(TARGET_SCHEMAS.desktop.map((rule) => [rule.path, rule]));

        for (const [path, type] of [['electronBuilder', 'object'], ['windows', 'object'], ['cdp', 'object'], ['fileAssociations', 'array'], ['protocols', 'array']]) {
          ctx.expect(rules.get(path)?.type, `targets.desktop.${path} owes a ${type} rule`).toBe(type);
          ctx.expect(rules.get(path).default, `${path} carries no default: the block is the brand's own`).toBe(undefined);
          ctx.expect(rules.get(path).description, `${path} says what reads it`).toBeTruthy();
        }

        // The backend's one documented override: the MCP consumer auth URL
        const backend = new Map(TARGET_SCHEMAS.backend.map((rule) => [rule.path, rule]));
        ctx.expect(backend.get('mcp.authUrl')?.type, 'targets.backend.mcp.authUrl owes a rule').toBe('string');
      },
    },

    {
      name: 'the manager switches default ON in the schema; its Stripe and GA4 data keep no default',
      run: (ctx) => {
        const { SHARED_SCHEMA, configSections } = require('../src/schema.js');
        const { schemaDefaults, missingDefaults } = require('../src/defaults.js');
        const rules = new Map(SHARED_SCHEMA.map((rule) => [rule.path, rule]));

        // Zero-data switches (case 2): default ON, materialized like every other
        for (const path of ['enabled', 'server.enabled', 'assets.enabled', 'payment.enabled']) {
          ctx.expect(rules.get(path)?.type, `${path} owes a boolean rule`).toBe('boolean');
          ctx.expect(rules.get(path).default, `${path} defaults ON`).toBe(true);
          ctx.expect(rules.get(path).materialize, `${path} is written into a brand file`).toBe(undefined);
        }
        const defaults = schemaDefaults();
        ctx.expect(defaults.enabled).toBe(true);
        ctx.expect(defaults.server.enabled).toBe(true);
        ctx.expect(defaults.assets.enabled).toBe(true);
        ctx.expect(defaults.payment.enabled).toBe(true);

        // A brand that authored none of them gets all four backfilled; one it switched off keeps its false
        const missing = missingDefaults({ brand: { id: 'x' }, payment: { enabled: false } });
        const paths = missing.map((entry) => entry.path);
        for (const path of ['enabled', 'server', 'assets']) ctx.expect(paths.includes(path), `${path} is backfilled`).toBeTruthy();
        ctx.expect(!paths.includes('payment.enabled'), 'an authored false is a decision, never overwritten').toBeTruthy();

        // Data the payment and analytics services write back: no framework answer
        for (const [path, type] of [
          ['payment.providers.stripe.updateAccountInfo', 'boolean'],
          ['payment.providers.stripe.radar', 'array'],
          ['payment.providers.stripe.radarConfirmed', 'boolean'],
          ['payment.providers.stripe.disputesConfirmed', 'boolean'],
          ['analytics.providers.google.timeZone', 'string'],
          ['analytics.providers.google.currency', 'string'],
          ['analytics.providers.google.enhancedMeasurement', 'object'],
        ]) {
          ctx.expect(rules.get(path)?.type, `${path} owes a ${type} rule`).toBe(type);
          ctx.expect(rules.get(path).default, `${path}: the manager's engine data is its default`).toBe(undefined);
        }

        // The brand switch is a scalar, never a namespace a page's `config:` overrides
        ctx.expect(!configSections('web').includes('enabled')).toBeTruthy();
      },
    },

    // The manage walk copies each description into a brand's omega.json5 as the
    // materialized block's comment, so a description is a clean present-tense line.
    {
      name: 'every schema description reads clean: no em dash, no issue tag',
      run: (ctx) => {
        const { SHARED_SCHEMA, TARGET_SCHEMAS } = require('../src/schema.js');
        const rules = [...SHARED_SCHEMA, ...Object.values(TARGET_SCHEMAS).flat()];
        const dirty = rules
          .filter((rule) => typeof rule.description === 'string')
          .filter((rule) => /\u2014|\(#|#\d/.test(rule.description))
          .map((rule) => rule.path);

        ctx.expect(rules.length > 200, 'the walk reaches every rule set').toBeTruthy();
        ctx.expect(dirty).toEqual([]);
      },
    },
  ],
});

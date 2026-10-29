/**
 * Unit tests for @omega.js/config's validate module — schema validation
 * (shared + per-target refinements), the `runSchema` primitive, and error
 * formatting. (File discovery + the full resolution chain are covered by
 * load.test.js.)
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const {
  validateConfig,
  runSchema,
  formatErrors,
  schemaDefaults,
  missingDefaults,
  TARGETS,
  AMO_CATEGORIES,
} = require('../src/index.js');

// ─── validateConfig: shared schema ───

const VALID = { brand: { id: 'sandbox-brand', name: 'Sandbox Brand' } };


// ─── the schema is STRICT: an undeclared path fails the load ───

const UNDECLARED = 'is not a key the schema declares. Remove it, or if it is a legacy key run `npx omega migrate` at the brand root (report) and `--execute` to convert (docs/shared/config.md → Validation)';

// ─── a declared list: the strict check walks each item ───

// A brand root carrying `source` as its config/omega.json5, loaded the real way
function loadStaged(source) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { loadConfig } = require('../src/load.js');

  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-config-home-'));

  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-config-brand-'));
    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(path.join(root, 'config', 'omega.json5'), source);
    return loadConfig(root);
  } finally {
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'validate',
  tests: [
    {
      name: 'minimal valid config passes',
      run: (ctx) => {
        ctx.expect(validateConfig(VALID).errors).toEqual([]);
      },
    },

    {
      name: 'missing required fields are reported',
      run: (ctx) => {
        const { errors } = validateConfig({ brand: { url: 'https://x.com' } });

        ctx.expect(errors.some((e) => e.startsWith('config.brand.id is required'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.startsWith('config.brand.name is required'))).toBeTruthy();
      },
    },

    {
      name: 'match, enum, and type violations are reported',
      run: (ctx) => {
        const { errors } = validateConfig({
          brand: { id: 'Not A Slug', name: 'X' },
          theme: { appearance: 'neon' },
          payment: { products: { basic: {} } },
        });

        ctx.expect(errors.some((e) => e.includes('config.brand.id') && e.includes('does not match'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.theme.appearance') && e.includes('must be one of [system, light, dark]'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.payment.products has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'email identity keys are optional but typed when present',
      run: (ctx) => {
        // The email path reads these instead of carrying a built-in identity
        // (docs/backend/email-system.md → "Identity is config, or it is an error").
        const configured = validateConfig({
          ...VALID,
          brand: {
            ...VALID.brand,
            contact: {
              email: 'hello@sandbox.example',
              carbonCopy: [{ email: 'audit@sandbox.example', name: 'Audit' }],
            },
            images: { wordmark: 'https://x.com/wordmark.png' },
          },
        });

        ctx.expect(configured.errors).toEqual([]);
        ctx.expect(validateConfig(VALID).errors).toEqual([]);

        const { errors } = validateConfig({
          ...VALID,
          brand: { ...VALID.brand, contact: { carbonCopy: 'not-an-array' } },
        });

        ctx.expect(errors.some((e) => e.includes('config.brand.contact.carbonCopy has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'brand.contact.person is not a key: a config carrying it fails the load',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          brand: { ...VALID.brand, contact: { email: 'hello@sandbox.example', person: { name: 'Jane Doe, CEO' } } },
        });

        ctx.expect(errors).toEqual([`config.brand.contact.person.name ${UNDECLARED}`]);
      },
    },

    {
      name: 'parent is not a key, and its last meaning is company.webhooks (#677)',
      run: (ctx) => {
        // Every shape of it fails like any unknown key: the loader knows no old
        // name, and `omega migrate` is what names the new home.
        for (const value of [false, 'self', 'https://api.example.com', true]) {
          const { errors } = validateConfig({ ...VALID, parent: value });
          ctx.expect(errors.some((e) => e.startsWith('config.parent is not a key the schema declares') && e.includes('npx omega migrate')), `parent: ${value} fails the load`).toBeTruthy();
          ctx.expect(!errors.some((e) => e.includes('company.webhooks')), 'the loader carries no legacy knowledge').toBeTruthy();
        }

        // The successor: a typed boolean inside the company block, default true.
        ctx.expect(validateConfig({ ...VALID, company: { id: 'itw-creative-works', webhooks: false } }).errors).toEqual([]);
        ctx.expect(validateConfig({ ...VALID, company: { id: 'itw-creative-works', webhooks: 'no' } }).errors
          .some((e) => e.includes('config.company.webhooks has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'company: the id is the one typed key, and the rest is resolved (#677)',
      run: (ctx) => {
        ctx.expect(validateConfig({ ...VALID, company: { id: 'itw-creative-works' } }).errors).toEqual([]);
        ctx.expect(validateConfig({ ...VALID, company: { id: 'self' } }).errors).toEqual([]);

        const { errors } = validateConfig({ ...VALID, company: { id: 42 } });
        ctx.expect(errors.some((e) => e.includes('config.company.id has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'auth.signup.maxPerIpPerDay is a positive integer (backend rule, #133)',
      run: (ctx) => {
        const opts = { target: 'backend' };

        // A brand raising the per-IP cap (shared NAT/CGNAT/VPN egress)
        ctx.expect(validateConfig({ ...VALID, auth: { signup: { maxPerIpPerDay: 25 } } }, opts).errors).toEqual([]);
        // Absent = the framework default (2) applies
        ctx.expect(validateConfig(VALID, opts).errors).toEqual([]);

        for (const value of [0, -1, 2.5]) {
          const { errors } = validateConfig({ ...VALID, auth: { signup: { maxPerIpPerDay: value } } }, opts);
          ctx.expect(errors.some((e) => e.includes('config.auth.signup.maxPerIpPerDay')), `${value} must fail validation; the cap is a positive integer`).toBeTruthy();
        }

        const { errors } = validateConfig({ ...VALID, auth: { signup: { maxPerIpPerDay: '2' } } }, opts);
        ctx.expect(errors.some((e) => e.includes('config.auth.signup.maxPerIpPerDay has wrong type') && e.includes('integer'))).toBeTruthy();
      },
    },

    {
      name: '#1061: connections.<provider>.max is a positive whole number, on a packaged provider and a brand\'s own',
      run: (ctx) => {
        for (const provider of ['google', 'house-sso']) {
          for (const max of [0, 1.5]) {
            const { errors } = validateConfig({ ...VALID, connections: { [provider]: { enabled: true, max } } });

            ctx.expect(errors.some((e) => e.includes(`connections.${provider}.max`)), `max: ${max} on ${provider} is refused naming the key: ${errors.join(' | ')}`).toBeTruthy();
          }
        }

        const raised = validateConfig({ ...VALID, connections: { google: { enabled: true, max: 2 }, 'house-sso': { enabled: true, max: 2 } } });

        ctx.expect(raised.errors, 'max: 2 passes').toEqual([]);
      },
    },

    {
      name: '#1061: the max default is 1, and it resolves without being written into a brand file',
      run: (ctx) => {
        const connections = schemaDefaults().connections;

        for (const [provider, entry] of Object.entries(connections)) {
          ctx.expect(entry.max, `${provider} resolves one account per user unless the brand raises it`).toBe(1);
        }

        for (const authored of [{}, { connections: { google: { enabled: true } } }]) {
          const paths = missingDefaults({ ...VALID, ...authored }).map((entry) => entry.path);

          ctx.expect(!paths.some((dotted) => dotted.startsWith('connections')), `no max is ever written into a brand file: ${paths.join(', ')}`).toBeTruthy();
        }
      },
    },

    {
      name: 'match/enum only run on present values — null/empty ids are silent',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          analytics: { providers: { google: { id: null }, meta: { id: null } } },
        });

        ctx.expect(errors).toEqual([]);
      },
    },

    {
      name: 'translation section: valid shape passes, providers block + types enforced',
      run: (ctx) => {
        ctx.expect(validateConfig({
            ...VALID,
            translation: { enabled: true, default: 'en', languages: ['es', 'fr'], providers: { claude: {} }, include: ['**', '!blog/**'] },
          }).errors).toEqual([]);

        const { errors } = validateConfig({
          ...VALID,
          translation: { languages: 'es', providers: 'chatgpt' },
        });

        ctx.expect(errors.some((e) => e.includes('config.translation.languages has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.translation.providers has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'monitoring + marketing in the new shape validate clean, and their role-level keys stay put (#425)',
      run: (ctx) => {
        ctx.expect(validateConfig({
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
          }).errors).toEqual([]);

        // …and the provider-hung leaves are typed, so a wrong shape still fails
        const { errors } = validateConfig({
          ...VALID,
          monitoring: { providers: { sentry: { dsn: 'sentry.test/1', sampleRate: 2 } } },
          marketing: { campaigns: { enabled: 'yes', providers: { sendgrid: { listId: 42 } } } },
        });

        ctx.expect(errors.some((e) => e.includes('config.monitoring.providers.sentry.dsn') && e.includes('does not match'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.monitoring.providers.sentry.sampleRate') && e.includes('above the maximum'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.marketing.campaigns.enabled has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.marketing.campaigns.providers.sendgrid.listId has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'devlog + seo are schema-known optional objects (manager-read sections)',
      run: (ctx) => {
        ctx.expect(validateConfig({ ...VALID, devlog: { enabled: true, providers: { ghostii: { orgs: ['x'] } } }, seo: { github: { content: [] } } }).errors).toEqual([]);

        const { errors } = validateConfig({ ...VALID, devlog: 'yes', seo: [1] });
        ctx.expect(errors.some((e) => e.includes('config.devlog has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.seo has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'the six manager-level sections are shared keys: a website-only brand carries them at the top level (#277)',
      run: (ctx) => {
        // The manager reads these at brand level UNFOLDED (manage.js loads the brand
        // config with no target), so a brand whose only target is web still needs a
        // home for them, and adding targets.backend just to hold them would falsely
        // enable the target.
        const websiteOnly = {
          ...VALID,
          targets: { web: { type: 'web' } },
          repo: { owner: 'itw-creative-works' },
          reviews: { enabled: true, sites: ['trustpilot.com'] },
          marketing: { campaigns: { enabled: true, providers: { sendgrid: { listId: 'lst_1' } } }, prune: { enabled: true } },
          blog: { enabled: false },
          dataRequest: { queries: [] },
        };

        ctx.expect(validateConfig(websiteOnly).errors).toEqual([]);
        ctx.expect(validateConfig(websiteOnly, { target: 'web' }).errors).toEqual([]);

        // Shared keys are TYPED shared too: no backend target needed to catch a shape mistake.
        const { errors } = validateConfig({ ...VALID, repo: 'itw', reviews: 'yes', marketing: [1], blog: 'on', dataRequest: 3 });
        ctx.expect(errors.some((e) => e.includes('config.repo has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.reviews has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.marketing has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.blog has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.dataRequest has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'directory + sponsorships are shared keys, typed shared, and secret-free (#246)',
      run: (ctx) => {
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

        ctx.expect(validateConfig(participating).errors).toEqual([]);
        ctx.expect(validateConfig(participating, { target: 'web' }).errors).toEqual([]);

        const { errors } = validateConfig({
          ...VALID,
          directory: { enabled: 'yes' },
          sponsorships: { acceptable: 'tech', unacceptable: 'gambling', prices: [70] },
        });
        ctx.expect(errors.some((e) => e.includes('config.directory.enabled has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.sponsorships.acceptable has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.sponsorships.unacceptable has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.sponsorships.prices has wrong type'))).toBeTruthy();

        // The entry is pushed into a world-readable collection: the secret-shape
        // guard is the hard floor on what a brand can put in these sections.
        const secret = validateConfig({ ...VALID, sponsorships: { apiSecret: 'sk_live_x' } });
        ctx.expect(secret.errors.some((e) => e.includes('config.sponsorships.apiSecret looks like a secret'))).toBeTruthy();
      },
    },

    {
      name: 'an unrecognized top-level key is an error: the six manager sections are NAMED keys (#277)',
      run: (ctx) => {
        ctx.expect(validateConfig({ ...VALID, bogusSection: { a: 1 } }).errors).toEqual(['config.bogusSection.a is not a key the schema declares. Remove it, or if it is a legacy key run `npx omega migrate` at the brand root (report) and `--execute` to convert (docs/shared/config.md → Validation)']);

        // A secret-shaped key still bounces as a secret alongside a bogus one
        const { errors } = validateConfig({
          ...VALID,
          bogusSection: { a: 1 },
          payment: { providers: { stripe: { apiSecret: 'x' } } },
        });
        ctx.expect(errors.some((e) => e.includes('config.payment.providers.stripe.apiSecret looks like a secret'))).toBeTruthy();
      },
    },

    // ─── validateConfig: targets sanity ───

    {
      name: '#886: every entry declares a type, and the KEY is only a name',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          targets: {
            web: { type: 'web' },
            untyped: {},
            admin: { type: 'website' },
            backend: true,
          },
        });

        ctx.expect(errors.some((e) => e.includes('config.targets.untyped must declare `type`'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.targets.admin must declare `type`') && e.includes('"website"'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.targets.backend must be an object declaring its type'))).toBeTruthy();
        ctx.expect(errors.length).toBe(3);
      },
    },

    {
      name: '#886: the retired instance ARRAY names its replacement, a sibling key',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          targets: { web: [{ id: 'main' }, { id: 'admin' }] },
        });

        ctx.expect(errors.some((e) => e.includes('config.targets.web is an array')
            && e.includes('sibling key')
            && e.includes('docs/shared/breaking-changes.md 2026-09-11')), `the array form must bounce with the migration pointer: ${errors.join(' | ')}`).toBeTruthy();
      },
    },

    {
      name: '#886: a key that is not a dir-safe slug is an error, since the name IS the folder',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          targets: { 'Admin Console': { type: 'web' } },
        });

        ctx.expect(errors.some((e) => e.includes('config.targets.Admin Console is not a usable target name'))).toBeTruthy();
        ctx.expect(errors.length).toBe(1);
      },
    },

    {
      name: '#886: any NAME is legal when its type is, so targets/website is a brand\'s own choice',
      run: (ctx) => {
        ctx.expect(validateConfig({ ...VALID, targets: { website: { type: 'web' }, community: { type: 'web' }, api: { type: 'custom' } } }).errors).toEqual([]);
      },
    },

    {
      name: 'all canonical types are accepted (mobile stays reserved but valid)',
      run: (ctx) => {
        const targets = Object.fromEntries(TARGETS.map((t) => [t, { type: t }]));

        ctx.expect(validateConfig({ ...VALID, targets }).errors).toEqual([]);
      },
    },

    {
      name: '#886: more than one backend target is a WARNING, never an error',
      run: (ctx) => {
        const multi = validateConfig({ ...VALID, targets: { backend: { type: 'backend' }, eu: { type: 'backend' } } });

        ctx.expect(multi.errors).toEqual([]);
        ctx.expect(multi.warnings.some((w) => w.includes('2 backend targets') && w.includes('unsupported'))).toBeTruthy();

        const single = validateConfig({ ...VALID, targets: { backend: { type: 'backend' } } });
        ctx.expect(single.errors).toEqual([]);
        ctx.expect(single.warnings).toEqual([]);
      },
    },

    // ─── validateConfig: per-target refinements ───

    {
      name: 'target refinements only apply with options.target',
      run: (ctx) => {
        const config = { ...VALID, startup: { mode: 'invisible' } };

        // Shared-only, a desktop key is just a key nobody declared
        ctx.expect(validateConfig(config).errors.map((e) => e.split(' ')[0])).toEqual(['config.startup.mode']);

        const { errors } = validateConfig(config, { target: 'desktop' });
        ctx.expect(errors.some((e) => e.includes('config.startup.mode') && e.includes('must be one of [normal, hidden]'))).toBeTruthy();
      },
    },

    {
      name: 'desktop remoteScripts is a declared key: the opt-in shape passes, wrong types are reported (#21)',
      run: (ctx) => {
        const armed = { ...VALID, remoteScripts: { enabled: true, url: 'https://acme.example.com/data/scripts/main.js' } };
        ctx.expect(validateConfig(armed, { target: 'desktop' }).errors).toEqual([]);

        const { errors } = validateConfig(
          { ...VALID, remoteScripts: { enabled: 'yes', url: 'ftp://acme.example.com/main.js' } },
          { target: 'desktop' },
        );
        ctx.expect(errors.some((e) => e.includes('config.remoteScripts.enabled has wrong type'))).toBeTruthy();
        ctx.expect(errors.some((e) => e.includes('config.remoteScripts.url') && e.includes('does not match'))).toBeTruthy();
      },
    },

    {
      name: 'desktop releases.enabled is a declared key: booleans pass, a string bounces (#124)',
      run: (ctx) => {
        const gated = { ...VALID, releases: { enabled: false } };
        ctx.expect(validateConfig(gated, { target: 'desktop' }).errors).toEqual([]);

        const { errors } = validateConfig(
          { ...VALID, releases: { enabled: 'nope' } },
          { target: 'desktop' },
        );
        ctx.expect(errors.some((e) => e.includes('config.releases.enabled has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'extension listings are declared keys: valid urls pass, a non-url bounces (#85)',
      run: (ctx) => {
        const listed = {
          ...VALID,
          listings: {
            chrome: { url: 'https://chromewebstore.google.com/detail/x', state: 'live' },
            firefox: { url: 'https://addons.mozilla.org/x' },
            edge: { url: 'https://microsoftedge.microsoft.com/addons/x' },
          },
        };
        ctx.expect(validateConfig(listed, { target: 'extension' }).errors).toEqual([]);

        const { errors } = validateConfig(
          { ...VALID, listings: { chrome: { url: 'not-a-url' } } },
          { target: 'extension' },
        );
        ctx.expect(errors.some((e) => e.includes('config.listings.chrome.url') && e.includes('does not match'))).toBeTruthy();
      },
    },

    {
      name: 'extension listing IDS are declared keys beside the url, one home for the store identifier (#893)',
      run: (ctx) => {
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
        ctx.expect(validateConfig(identified, { target: 'extension' }).errors).toEqual([]);

        const { errors } = validateConfig(
          { ...VALID, listings: { chrome: { id: 12345 } } },
          { target: 'extension' },
        );
        ctx.expect(errors.some((e) => e.includes('config.listings.chrome.id has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'extension categories are AMO slugs: the live list passes, anything else names the list (#884)',
      run: (ctx) => {
        // The first Firefox publish sends these to addons.mozilla.org verbatim, so a
        // slug AMO does not know is a submission that fails at the store instead of
        // in the build. Every live slug validates, because the list IS the schema's.
        ctx.expect(validateConfig({ ...VALID, categories: AMO_CATEGORIES }, { target: 'extension' }).errors).toEqual([]);

        const { errors } = validateConfig(
          { ...VALID, categories: ['alerts-updates', 'productivity'] },
          { target: 'extension' },
        );
        ctx.expect(errors.some((e) => e.includes('config.categories') && e.includes('"productivity"') && e.includes('alerts-updates'))).toBeTruthy();

        const typed = validateConfig({ ...VALID, categories: 'alerts-updates' }, { target: 'extension' });
        ctx.expect(typed.errors.some((e) => e.includes('config.categories has wrong type'))).toBeTruthy();
      },
    },

    {
      name: 'unknown options.target throws (programmer error, not a config error)',
      run: (ctx) => {
        ctx.expect(() => validateConfig(VALID, { target: 'website' })).toThrow(/Unknown target "website"/);
      },
    },

    // ─── validateConfig: secrets ───

    {
      name: 'secret-shaped keys are validation errors',
      run: (ctx) => {
        const { errors } = validateConfig({ ...VALID, payment: { providers: { stripe: { apiSecret: 'x' } } } });

        ctx.expect(errors.some((e) => e.includes('config.payment.providers.stripe.apiSecret looks like a secret'))).toBeTruthy();
      },
    },

    // ─── validateConfig: a product price is a number (#674) ───

    {
      name: 'a bare-number price catalog passes, at every frequency and for `once`',
      run: (ctx) => {
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

        ctx.expect(errors).toEqual([]);
      },
    },

    {
      name: 'an object-shaped price is refused, naming the product and the key (#674)',
      run: (ctx) => {
        // The disagreement it closes: the checkout page unwrapped `{ amount: N }` and
        // every backend reader took the bare number, so this shape priced the summary
        // correctly and put `[object Object]` in the confirmation URL's amount.
        const { errors } = validateConfig({
          ...VALID,
          payment: {
            products: [{ id: 'credits', type: 'one-time', prices: { once: { amount: 49.99 } } }],
          },
        });

        ctx.expect(errors.length).toBe(1);
        ctx.expect(errors[0].includes('config.payment.products'), errors[0]).toBeTruthy();
        ctx.expect(errors[0].includes('credits'), errors[0]).toBeTruthy();
        ctx.expect(errors[0].includes('once'), errors[0]).toBeTruthy();
      },
    },

    {
      name: 'a subscription price carrying the same object shape is refused too (#674)',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          payment: { products: [{ id: 'premium', type: 'subscription', prices: { monthly: { amount: 9.99 }, annually: 99.99 } }] },
        });

        ctx.expect(errors.length, errors.join(' | ')).toBe(1);
        ctx.expect(errors[0].includes('monthly'), errors[0]).toBeTruthy();
      },
    },

    // ─── validateConfig: authDomain is the brand's own host (cp268) ───

    {
      name: 'an authDomain equal to the brand host passes (the playground shape)',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          brand: { ...VALID.brand, url: 'https://playground.omegajs.dev' },
          cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'playground.omegajs.dev' } },
        });

        ctx.expect(errors).toEqual([]);
      },
    },

    {
      name: 'a firebaseapp.com authDomain hard-fails, naming the self-hosted requirement',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          brand: { ...VALID.brand, url: 'https://playground.omegajs.dev' },
          cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'omegajs-playground.firebaseapp.com' } },
        });

        ctx.expect(errors.length).toBe(1);
        ctx.expect(errors[0].includes('config.cloud.config.authDomain')).toBeTruthy();
        ctx.expect(errors[0].includes('firebaseapp.com')).toBeTruthy();
        ctx.expect(errors[0].includes('/__/auth/*'), 'the message says self-hosting is the requirement').toBeTruthy();
      },
    },

    {
      name: 'an authDomain on another host fails, naming both values',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          brand: { ...VALID.brand, url: 'https://playground.omegajs.dev' },
          cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'auth.other.example' } },
        });

        ctx.expect(errors.length).toBe(1);
        ctx.expect(errors[0].includes('auth.other.example'), 'the configured value').toBeTruthy();
        ctx.expect(errors[0].includes('playground.omegajs.dev'), 'the brand host').toBeTruthy();
      },
    },

    // #588 (Ian 2026-09-01): the authDomain is a BRAND fact. One Firebase project,
    // one backend, shared by every instance a brand runs, so the comparison reads
    // brand.url and never the instance's own top-level `url` (which a multi-instance
    // target now derives from the instance id). Reading it the other way made a
    // `targets/website-admin` load fail its own brand's authDomain.
    {
      name: 'authDomain compares against the BRAND host, never the instance url',
      run: (ctx) => {
        const base = {
          ...VALID,
          brand: { ...VALID.brand, url: 'https://playground.omegajs.dev' },
          cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'playground.omegajs.dev' } },
        };

        ctx.expect(validateConfig({ ...base, url: 'https://admin.omegajs.dev' }, { target: 'web' }).errors, "an instance's url does not turn the brand's own authDomain into a mismatch").toEqual([]);

        // ... and it licenses nothing either: an authDomain on the INSTANCE host is
        // still the mismatch it was, named against the brand host
        const onInstanceHost = validateConfig({
          ...base,
          url: 'https://admin.omegajs.dev',
          cloud: { provider: 'firebase', config: { projectId: 'omegajs-playground', authDomain: 'admin.omegajs.dev' } },
        }, { target: 'web' });

        ctx.expect(onInstanceHost.errors.length).toBe(1);
        ctx.expect(onInstanceHost.errors[0].includes('playground.omegajs.dev'), 'the brand host is what it names').toBeTruthy();
      },
    },

    {
      name: 'an absent authDomain passes, and a demo-* project is exempt',
      run: (ctx) => {
        const absent = validateConfig({
          ...VALID,
          brand: { ...VALID.brand, url: 'https://sandbox-brand.example.com' },
          cloud: { provider: 'firebase', config: { projectId: 'demo-sandbox-brand' } },
        });
        ctx.expect(absent.errors).toEqual([]);

        // demo-* is emulator-only: no real project, no redirect sign-in
        const demo = validateConfig({
          ...VALID,
          brand: { ...VALID.brand, url: 'https://sandbox-brand.example.com' },
          cloud: { provider: 'firebase', config: { projectId: 'demo-sandbox-brand', authDomain: 'demo-sandbox-brand.firebaseapp.com' } },
        });
        ctx.expect(demo.errors).toEqual([]);
      },
    },

    {
      name: '#564: `targets.web.meta.index` is LIVE, the site-wide default of the page flag',
      run: (ctx) => {
        // Authored shape: nothing in the block is retired any more.
        ctx.expect(validateConfig({ ...VALID, targets: { web: { type: 'web', meta: { index: false } } } }, { target: 'web' }).errors, 'the authored site default carries no retired key').toEqual([]);

        // Resolved shape: a target's keys land at the top level, which is where the
        // web schema rule reads them.
        ctx.expect(validateConfig({ ...VALID, meta: { index: false } }, { target: 'web' }).errors, 'the resolved site default validates clean').toEqual([]);

        const bad = validateConfig({ ...VALID, meta: { index: 'false' } }, { target: 'web' });
        ctx.expect(bad.errors.some((e) => e.includes('meta.index') && e.includes('boolean')), `a non-boolean must bounce: ${bad.errors.join(' | ')}`).toBeTruthy();
      },
    },

    // ─── one repo block, one hosting key (#883) ───────────────────────────────

    // `repo: { provider, owner }` is the whole declaration, and the owner holds
    // every repo the brand's names derive under. A block with no owner would let
    // every derivation answer null and every reader skip in its own quiet way.
    {
      name: '#883: the repo block is provider + owner, and the owner is required when the block is there',
      run: (ctx) => {
        ctx.expect(validateConfig({ ...VALID, repo: { owner: 'Acme-Org' } }).errors).toEqual([]);
        ctx.expect(validateConfig({ ...VALID, repo: { provider: 'github', owner: 'Acme' } }).errors).toEqual([]);

        const { errors } = validateConfig({ ...VALID, repo: { provider: 'github' } });
        ctx.expect(errors.some((e) => e.includes('config.repo.owner is required when the repo block is present')), `an owner-less block must bounce: ${errors.join(' | ')}`).toBeTruthy();

        ctx.expect(validateConfig({ ...VALID, repo: { owner: '   ' } }).errors
            .some((e) => e.includes('config.repo.owner is required')), 'whitespace is not an owner').toBeTruthy();
      },
    },

    // The retired key is no alias: the strict schema refuses it and points at the
    // one code that converts it.
    {
      name: 'repo.org is refused, naming the path and npx omega migrate',
      run: (ctx) => {
        const { errors } = validateConfig({ ...VALID, repo: { provider: 'github', org: 'Acme' } });

        ctx.expect(errors.some((e) => e.startsWith('config.repo.org ') && e.includes('npx omega migrate')), `repo.org must fail the load: ${errors.join(' | ')}`).toBeTruthy();
      },
    },

    {
      name: '#883: repo.provider names a host OMEGA builds for',
      run: (ctx) => {
        const { errors } = validateConfig({ ...VALID, repo: { provider: 'gitlab', owner: 'Acme-Org' } });

        ctx.expect(errors.some((e) => e.includes('config.repo.provider "gitlab" is not a host OMEGA builds for')
            && e.includes('github')), `an unbuilt provider must bounce and name the table: ${errors.join(' | ')}`).toBeTruthy();
      },
    },

    // Only a web target has a built site to serve, so `hosting` anywhere else is a
    // statement nothing reads: the deploy would publish nothing and the manage walk
    // would create no repo for it.
    {
      name: '#883: hosting is a WEB target key, and its provider is table-checked',
      run: (ctx) => {
        ctx.expect(validateConfig({
            ...VALID,
            repo: { owner: 'Acme-Org' },
            targets: { web: { type: 'web', hosting: { provider: 'github' } }, community: { type: 'web' } },
          }).errors).toEqual([]);

        const wrongTarget = validateConfig({
          ...VALID,
          targets: { web: { type: 'web' }, desktop: { type: 'desktop', hosting: { provider: 'github' } } },
        });
        ctx.expect(wrongTarget.errors.some((e) => e.includes('config.targets.desktop.hosting is a web-target key')), `hosting on a non-web target must bounce: ${wrongTarget.errors.join(' | ')}`).toBeTruthy();

        const wrongProvider = validateConfig({
          ...VALID,
          targets: { web: { type: 'web', hosting: { provider: 'vercel' } } },
        });
        ctx.expect(wrongProvider.errors.some((e) => e.includes('config.targets.web.hosting.provider "vercel" is not a host OMEGA builds for')), `an unbuilt hosting provider must bounce: ${wrongProvider.errors.join(' | ')}`).toBeTruthy();
      },
    },

    // `releases: {}` stays the presence switch for the site's download links: only
    // the owner/repo override left with #883.
    {
      name: '#883: a bare releases block still validates, with no repo to name',
      run: (ctx) => {
        ctx.expect(validateConfig({
            ...VALID,
            repo: { owner: 'Acme-Org' },
            targets: { web: { type: 'web' }, desktop: { type: 'desktop', releases: {} } },
          }).errors).toEqual([]);
      },
    },

    {
      name: 'the new homes themselves validate clean — the provider keeps its own name one level down',
      run: (ctx) => {
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
          repo: { owner: 'Acme-Org' },
          cloud: { provider: 'firebase', config: { projectId: 'acme' }, organizationId: false, billingAccount: false },
          advertising: { providers: { adsense: { client: 'ca-pub-1', displaySlot: '1' } } },
        };

        ctx.expect(validateConfig(config).errors).toEqual([]);
      },
    },

    // ─── runSchema: conditional required ───

    {
      name: 'required-as-function receives the full config',
      run: (ctx) => {
        const schema = [{
          path: 'analytics.providers.google.id',
          type: 'string',
          required: (config) => config.analytics && config.analytics.enabled === true,
        }];

        ctx.expect(runSchema({ analytics: { enabled: false } }, schema)).toEqual([]);
        ctx.expect(runSchema({ analytics: { enabled: true } }, schema).length).toBe(1);
      },
    },

    {
      name: 'integer type + min bound: only whole numbers at or above the bound pass',
      run: (ctx) => {
        const schema = [{ path: 'limits.perDay', type: 'integer', min: 1 }];

        ctx.expect(runSchema({ limits: { perDay: 1 } }, schema)).toEqual([]);
        ctx.expect(runSchema({ limits: { perDay: 99 } }, schema)).toEqual([]);
        ctx.expect(runSchema({ limits: { perDay: 1.5 } }, schema).length).toBe(1);
        ctx.expect(runSchema({ limits: { perDay: 0 } }, schema)[0]).toMatch(/limits\.perDay 0 is below the minimum 1/);
      },
    },

    {
      name: 'a throwing required() rule surfaces as a named error, never silent-optional',
      run: (ctx) => {
        const schema = [{
          path: 'brand.name',
          type: 'string',
          required: () => { throw new Error('broken rule'); },
        }];

        const errors = runSchema({}, schema);
        ctx.expect(errors.length).toBe(1);
        ctx.expect(errors[0]).toMatch(/brand\.name required\(\) threw: broken rule/);
      },
    },

    // ─── formatErrors ───

    {
      name: 'formatErrors renders a numbered block; empty list renders empty',
      run: (ctx) => {
        ctx.expect(formatErrors([])).toBe('');
        ctx.expect(formatErrors(['a', 'b'])).toBe('  1. a\n  2. b');
      },
    },

    // #272 — brand.color is documented (packages/web/README.md) and consumed by
    // the engine (head.html builds the --omega-accent ramps from it), so the
    // schema owes it a shape: the ramp composer reads a hex string.
    {
      name: 'brand.color is optional, hex-validated when present',
      run: (ctx) => {
        ctx.expect(validateConfig({ ...VALID, brand: { ...VALID.brand, color: '#4F46E5' } }).errors, 'a 6-digit hex passes').toEqual([]);
        ctx.expect(validateConfig({ ...VALID, brand: { ...VALID.brand, color: '#f0a' } }).errors, 'the 3-digit form passes').toEqual([]);
        ctx.expect(validateConfig(VALID).errors, 'absence stays valid').toEqual([]);

        const junk = validateConfig({ ...VALID, brand: { ...VALID.brand, color: 'indigo' } });
        ctx.expect(junk.errors.some((e) => e.includes('config.brand.color') && e.includes('does not match')), `a non-hex color fails loudly: ${junk.errors.join(' | ')}`).toBeTruthy();

        const typed = validateConfig({ ...VALID, brand: { ...VALID.brand, color: 0x4F46E5 } });
        ctx.expect(typed.errors.some((e) => e.includes('config.brand.color has wrong type')), 'a number is not a color').toBeTruthy();
      },
    },

    // #250 — the purge pass now READS targets.web.purgecss.safelist
    // (packages/web/src/assets.js mergeSafelist), so the schema owes it a shape:
    // the object form's lanes and the array shorthand PurgeCSS itself accepts.
    {
      name: 'targets.web.purgecss.safelist is declared — both accepted shapes pass, a mistyped one is loud',
      run: (ctx) => {
        const lanes = validateConfig({
          ...VALID,
          purgecss: { safelist: { standard: ['collapse'], deep: ['^tooltip'], greedy: ['^brand-'], keyframes: ['^fade'] } },
        }, { target: 'web' });
        ctx.expect(lanes.errors, 'every lane takes an array of string patterns').toEqual([]);

        // PurgeCSS's own shorthand: a bare array IS the standard lane.
        ctx.expect(validateConfig({ ...VALID, purgecss: { safelist: ['collapse'] } }, { target: 'web' }).errors, 'the array shorthand passes').toEqual([]);
        ctx.expect(validateConfig(VALID, { target: 'web' }).errors, 'absence stays valid').toEqual([]);

        // The typo that used to purge a brand's classes silently.
        const bare = validateConfig({ ...VALID, purgecss: { safelist: 'brand-' } }, { target: 'web' });
        ctx.expect(bare.errors.some((e) => e.includes('config.purgecss.safelist has wrong type')), `a bare string is not a safelist: ${bare.errors.join(' | ')}`).toBeTruthy();

        const lane = validateConfig({ ...VALID, purgecss: { safelist: { greedy: '^brand-' } } }, { target: 'web' });
        ctx.expect(lane.errors.some((e) => e.includes('config.purgecss.safelist.greedy has wrong type')), `a lane takes an array, not one pattern: ${lane.errors.join(' | ')}`).toBeTruthy();

        const section = validateConfig({ ...VALID, purgecss: ['collapse'] }, { target: 'web' });
        ctx.expect(section.errors.some((e) => e.includes('config.purgecss has wrong type')), 'the section itself is an object').toBeTruthy();
      },
    },

    // ─── targets.backend.projectType (#584) ───

    {
      name: 'targets.backend.projectType takes firebase or custom, and nothing else',
      run: (ctx) => {
        ctx.expect(validateConfig({ ...VALID, projectType: 'firebase' }, { target: 'backend' }).errors).toEqual([]);
        ctx.expect(validateConfig({ ...VALID, projectType: 'custom' }, { target: 'backend' }).errors).toEqual([]);
        ctx.expect(validateConfig(VALID, { target: 'backend' }).errors, 'absence is the firebase default').toEqual([]);

        const wrong = validateConfig({ ...VALID, projectType: 'render' }, { target: 'backend' });
        ctx.expect(wrong.errors.some((e) => e.includes('config.projectType') && e.includes('custom')), `an unknown project type must be loud and name the options: ${wrong.errors.join(' | ')}`).toBeTruthy();
      },
    },

    {
      name: 'an undeclared leaf is an error naming the path and omega migrate',
      run: (ctx) => {
        const { warnings, errors } = validateConfig({ ...VALID, brand: { ...VALID.brand, nickname: 'sandy' } });

        ctx.expect(errors).toEqual([`config.brand.nickname ${UNDECLARED}`]);
        ctx.expect(warnings, 'never a warning: the load fails').toEqual([]);
      },
    },

    {
      name: 'one error line per undeclared path, so a brand sees each key',
      run: (ctx) => {
        const { errors } = validateConfig({ ...VALID, brand: { ...VALID.brand, nickname: 'sandy' }, extras: { a: 1, b: [2] } });

        ctx.expect(errors).toEqual([
          `config.brand.nickname ${UNDECLARED}`,
          `config.extras.a ${UNDECLARED}`,
          `config.extras.b ${UNDECLARED}`,
        ]);
      },
    },

    {
      name: 'a retired name fails exactly like any unknown key, with no special message',
      run: (ctx) => {
        const { errors } = validateConfig({ ...VALID, slapform: { endpoint: 'https://slapform.test/f/abc' }, translation: { exclude: ['docs'] } });

        ctx.expect(errors).toEqual([
          `config.slapform.endpoint ${UNDECLARED}`,
          `config.translation.exclude ${UNDECLARED}`,
        ]);
      },
    },

    {
      name: 'a retired key inside a target entry fails its PER-TARGET load, hoisted to the top level',
      run: (ctx) => {
        const config = { ...VALID, targets: { web: { type: 'web', download: { mac: 'https://acme.test/mac.dmg' } } } };

        // The whole-file walk leaves the targets namespace to the targets check…
        ctx.expect(validateConfig(config).errors).toEqual([]);

        // …and the target's own load sees the key where its framework would read it
        const { errors } = validateConfig({ ...VALID, download: { mac: 'https://acme.test/mac.dmg' } }, { target: 'web' });
        ctx.expect(errors).toEqual([`config.download.mac ${UNDECLARED}`]);
      },
    },

    {
      name: 'a fully declared config fails nothing',
      run: (ctx) => {
        const declared = {
          ...VALID,
          theme: { id: 'classy', appearance: 'system' },
          captcha: { providers: { recaptcha: { siteKey: '6Lc-key', domainsConfirmed: ['brand.test'] } } },
          certificates: { enabled: true, providers: { apple: { bundleIdPrefix: 'com.acme' } } },
          domain: { providers: { namecheap: {} } },
          advertising: { fallback: 'inhouse', tags: ['news'] },
        };

        ctx.expect(validateConfig(declared)).toEqual({ errors: [], warnings: [] });
      },
    },

    {
      name: 'a declared object/array rule keeps its subtree open',
      run: (ctx) => {
        // brand.address is the brand's own postal shape, connections an open
        // provider map, and an empty section a schema declares BELOW is no leaf.
        const { errors } = validateConfig({
          ...VALID,
          brand: { ...VALID.brand, address: { line1: '1 Main St', city: 'Springfield' } },
          connections: { acme: { enabled: true, scope: ['read'] } },
          certificates: {},
        });

        ctx.expect(errors).toEqual([]);
      },
    },

    {
      name: 'the whole-file walk leaves a target entry\'s own keys to the targets check',
      run: (ctx) => {
        const { errors } = validateConfig({
          ...VALID,
          targets: { web: { type: 'web', whateverThePageWants: true }, api: { type: 'custom', port: 8080 } },
        });

        ctx.expect(errors, 'targets.<name>.* is judged by that target\'s own load, and a custom target\'s keys are its own').toEqual([]);
      },
    },

    // The documented desktop escape hatches: build-config and the runtime read
    // each one off the resolved desktop config, so strictness must keep them open.
    {
      name: 'the desktop escape hatches pass a desktop load: electronBuilder, windows, cdp, fileAssociations, protocols',
      run: (ctx) => {
        const config = {
          ...VALID,
          electronBuilder: { mac: { hardenedRuntime: true }, extraResources: ['assets/**'] },
          windows: { main: { width: 1200, titleBarOverlay: { color: '#000' } } },
          cdp: { readySignal: 'overlay' },
          fileAssociations: [{ ext: 'acme', name: 'Acme File' }],
          protocols: [{ name: 'Acme', schemes: ['acme'] }],
        };

        ctx.expect(validateConfig(config, { target: 'desktop' }).errors).toEqual([]);

        const wrong = validateConfig({ ...VALID, electronBuilder: 'yes', fileAssociations: { ext: 'acme' } }, { target: 'desktop' }).errors;
        ctx.expect(wrong.some((e) => e.includes('config.electronBuilder has wrong type')), wrong.join(' | ')).toBeTruthy();
        ctx.expect(wrong.some((e) => e.includes('config.fileAssociations has wrong type')), wrong.join(' | ')).toBeTruthy();
      },
    },

    // The manager's own switches and engine data: documented, brand-overridable,
    // and written back by its services, so each one owes a rule.
    {
      name: 'the manager-read keys pass: the brand switch, the service switches, stripe and GA4 engine data',
      run: (ctx) => {
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

        ctx.expect(validateConfig(config).errors).toEqual([]);
        ctx.expect(validateConfig({ ...VALID, server: false, assets: false }).errors, 'the section-level off switch too').toEqual([]);
      },
    },

    // Keys the framework writes onto a RESOLVED config, never a brand: the company
    // the loader fills and the build facts a surface bakes. A decorated config
    // re-validated at boot (the desktop main process) must pass.
    {
      name: 'the loader-filled company and the baked build facts pass a DECORATED re-validation',
      run: (ctx) => {
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

        ctx.expect(validateConfig(resolved, { target: 'desktop', decorated: true }).errors).toEqual([]);

        // An authored load declares no build fact: a brand typing one is refused
        const authored = validateConfig(resolved, { target: 'desktop' }).errors.map((e) => e.split(' ')[0]);
        ctx.expect(authored).toEqual(['config.runtime', 'config.environment', 'config.version', 'config.buildTime', 'config.target', 'config.dev']);
      },
    },

    {
      name: 'a typo under a web dev key fails by default: `dev` is no open build fact on an authored load',
      run: (ctx) => {
        const { errors } = validateConfig({ ...VALID, dev: { limitCollectionz: 5 } }, { target: 'web' });

        ctx.expect(errors).toEqual([`config.dev.limitCollectionz ${UNDECLARED}`]);
      },
    },

    // A section with typed keys is CLOSED: only a rule with nothing declared
    // beneath it (or `open: true`) opens its subtree.
    {
      name: 'a retired path or a typo inside a container section fails the load',
      run: (ctx) => {
        const cases = [
          [{ devlog: { enabeld: true } }, undefined, 'devlog.enabeld'],
          [{ devlog: { enabled: true, lookbackDays: 3 } }, undefined, 'devlog.lookbackDays'],
          [{ marketing: { campaigns: { provider: 'sendgrid' } } }, undefined, 'marketing.campaigns.provider'],
          [{ blog: { provider: 'ghostii' } }, undefined, 'blog.provider'],
          [{ seo: { index: false } }, undefined, 'seo.index'],
          [{ repo: { owner: 'Acme-Org', providers: { github: { org: 'Acme-Org' } } } }, undefined, 'repo.providers.github.org'],
          [{ meta: { title: 'Site' } }, 'web', 'meta.title'],
          [{ platforms: { win: { arch: ['x64'] } } }, 'desktop', 'platforms.win.arch'],
          [{ platforms: { linux: { snap: { enabled: true } } } }, 'desktop', 'platforms.linux.snap.enabled'],
          [{ releases: { owner: 'Acme-Org', repo: 'acme-bins' } }, 'desktop', 'releases.owner'],
        ];

        for (const [config, target, path] of cases) {
          const { errors } = validateConfig({ ...VALID, ...config }, { target });
          ctx.expect(errors.includes(`config.${path} ${UNDECLARED}`), `${path} must fail: ${errors.join(' | ')}`).toBeTruthy();
        }

        // The open bags stay open: the client settings bag and the cloudflare engine data
        ctx.expect(validateConfig({ ...VALID, client: { auth: { enabled: true } }, edge: { providers: { cloudflare: { settings: { ssl: 'full' } } } } }).errors).toEqual([]);
      },
    },

    {
      name: 'an seo content item carrying org fails the load, naming the item by its position',
      run: (ctx) => {
        const { errors } = loadStaged(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand' },
  seo: { github: { content: [{ name: 'fixture-tool', org: 'Acme-Org' }] } },
}
`);

        ctx.expect(errors).toEqual([`config.seo.github.content[0].org ${UNDECLARED}`]);
      },
    },

    {
      name: 'an seo content item carrying only declared keys loads',
      run: (ctx) => {
        const { errors } = loadStaged(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand' },
  seo: { github: { content: [{ name: 'fixture-tool', owner: 'Acme-Org', title: 'Fixture Tool', description: 'automates fixture things' }] } },
}
`);

        ctx.expect(errors).toEqual([]);
      },
    },

    {
      name: 'a list with no keys declared below it stays one value: nothing inside payment.products is judged',
      run: (ctx) => {
        const { errors } = validateConfig({ ...VALID, payment: { products: [{ id: 'basic', name: 'Basic', madeUpKey: { deep: true } }] } });

        ctx.expect(errors).toEqual([]);
      },
    },

    {
      name: 'every key the seo repo op and its templates read off an item has a schema rule',
      run: (ctx) => {
        const { SHARED_SCHEMA } = require('../src/schema.js');
        const paths = SHARED_SCHEMA.map((rule) => rule.path);
        const read = ['name', 'owner', 'template', 'title', 'description', 'topics', 'features', 'cta', 'custom', 'author'];

        ctx.expect(paths.includes('seo.github.content'), 'the list itself owes a rule').toBeTruthy();
        for (const key of read) {
          ctx.expect(paths.includes(`seo.github.content.${key}`), `seo.github.content.${key} owes a rule`).toBeTruthy();
        }
      },
    },

    // The drift guard: a framework's ANNOTATED DEFAULT is the checklist of what
    // its runtime reads, so it must declare itself completely.
    {
      name: 'the desktop annotated default carries no undeclared paths (#911)',
      run: (ctx) => {
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

          ctx.expect(errors, errors.join(' | ')).toEqual([]);
          ctx.expect(warnings, warnings.join(' | ')).toEqual([]);
        } finally {
          if (previous === undefined) delete process.env.OMEGA_HOME;
          else process.env.OMEGA_HOME = previous;
        }
      },
    },

    // Every in-repo brand loads clean, whole-file AND through each target's own
    // load, which hoists targets.<name>.* to the top level where strictness sees it.
    {
      name: 'the in-repo brands load with zero errors, whole-file and per target',
      run: (ctx) => {
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
            ctx.expect(whole.errors, `${brand}: ${whole.errors.join(' | ')}`).toEqual([]);

            for (const [name, entry] of Object.entries(whole.config.targets || {})) {
              if (!TARGETS.includes(entry.type) || entry.type === 'mobile') continue;

              const dir = fs.existsSync(path.join(root, 'targets', name)) ? path.join(root, 'targets', name) : root;
              const { errors } = loadConfig(dir, entry.type);
              ctx.expect(errors, `${brand} targets.${name}: ${errors.join(' | ')}`).toEqual([]);
            }
          }
        } finally {
          if (previous === undefined) delete process.env.OMEGA_HOME;
          else process.env.OMEGA_HOME = previous;
        }
      },
    },

    // The ONE authored-file walk the migrate pass and the web converter share
    {
      name: 'undeclaredAuthoredPaths: the whole file, then each framework target as its own load sees it',
      run: (ctx) => {
        const { undeclaredAuthoredPaths } = require('../src/index.js');
        const file = {
          ...VALID,
          bogus: 1,
          targets: { web: { type: 'web', meta: { index: false }, nope: true }, api: { type: 'custom', port: 8080 }, odd: { type: 'website', x: 1 } },
        };

        ctx.expect(undeclaredAuthoredPaths(file)).toEqual(['bogus', 'targets.web.nope']);

        // A target's own file: its top level is that target's layer
        ctx.expect(undeclaredAuthoredPaths({ meta: { index: false }, nope: true }, { target: 'web' })).toEqual(['nope']);
        ctx.expect(undeclaredAuthoredPaths({ meta: { index: false } })).toEqual(['meta.index']);
      },
    },
  ],
});

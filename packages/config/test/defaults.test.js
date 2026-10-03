/**
 * Schema-derived defaults ([#478](https://github.com/Omega-JS-Stack/omega/issues/478)):
 * the schema is the ONE home of every config default, the merge chain's lowest
 * layer derives from it, and `missingDefaults()` names the blocks a brand file
 * has yet to materialize (the manage-walk heal reads exactly this list).
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * writeback tests' convention.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

// The machine registry is per-machine state: this file's fixtures record into a temp home.
require('@omega.js/devkit/test/temp-home');

const {
  schemaDefaults, missingDefaults, defaultComments, planMerge, setAtPath, loadConfig, validateConfig, writeConfigValues,
} = require('../src/index.js');
const { SHARED_SCHEMA, TARGET_SCHEMAS } = require('../src/schema.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

function makeBrand(name, contents) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), contents);
  return root;
}

function cleanup(t, root) {
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
}

// ─── connections: the packaged card table (#793) ───

// The provider files @omega.js/backend ships: config is vendored into surfaces
// that never install the backend, so the card table cannot be read from them
// at load time, and this read is what keeps the two sides in step.
const PACKAGED_PROVIDERS_DIR = path.join(__dirname, '..', '..', 'backend', 'src', 'omega', 'routes', 'user', 'connections', 'providers');

module.exports = defineCases({
  type: 'group',
  description: 'defaults',
  tests: [
    // ─── schemaDefaults ───

    {
      name: 'schemaDefaults: every schema `default:` lands at its own dot-path',
      run: (ctx) => {
        const defaults = schemaDefaults();

        ctx.expect(defaults.marketing.campaigns.enabled).toBe(true);
        ctx.expect(defaults.search.providers.searchConsole.sitemapPaths).toEqual(['/sitemap.xml']);

        // The `repo` block carries none (#883): its PRESENCE enables the repo
        // service, so a defaulted provider would say a brand hosts its source
        // somewhere when it declared nothing at all.
        ctx.expect(defaults.repo).toBe(undefined);
      },
    },

    {
      name: 'schemaDefaults: marketing.prune.enabled defaults TRUE (Ian 2026-08-22)',
      run: (ctx) => {
        // The #422 follow-up: pruning is ON by default, visible in config, per-brand
        // disableable — never the old opt-in silence.
        const rule = SHARED_SCHEMA.find((entry) => entry.path === 'marketing.prune.enabled');

        ctx.expect(rule.default).toBe(true);
        ctx.expect(schemaDefaults().marketing.prune.enabled).toBe(true);
      },
    },

    {
      name: 'schemaDefaults: owner-only decisions and provisioned ids carry NO default',
      run: (ctx) => {
        // Nothing here has a sane framework answer: secrets live in .env, ids are
        // written back by the services, tri-states mean "ask".
        const undefaulted = [
          'brand.id',
          'cloud.config.projectId',
          'cloud.billingAccount',
          'cloud.organizationId',
          'marketing.campaigns.providers.sendgrid.listId',
          'marketing.newsletter.providers.beehiiv.publicationId',
          'payment.providers.stripe.publishableKey',
          'monitoring.providers.sentry.dsn',
          'inbound.chat.providers.chatsy.agentId',
          'forms.providers.slapform.formId',
        ];

        for (const dotted of undefaulted) {
          const rule = SHARED_SCHEMA.find((entry) => entry.path === dotted);
          ctx.expect(rule, `missing schema entry ${dotted}`).toBeTruthy();
          ctx.expect(!Object.prototype.hasOwnProperty.call(rule, 'default'), `${dotted} must not carry a default`).toBeTruthy();
        }
      },
    },

    {
      name: 'schemaDefaults: each call returns its own copy — a caller cannot mutate the schema',
      run: (ctx) => {
        const first = schemaDefaults();
        first.marketing.prune.enabled = false;
        first.search.providers.searchConsole.sitemapPaths.push('/sitemap-2.xml');

        const second = schemaDefaults();
        ctx.expect(second.marketing.prune.enabled).toBe(true);
        ctx.expect(second.search.providers.searchConsole.sitemapPaths).toEqual(['/sitemap.xml']);
      },
    },

    {
      name: 'schemaDefaults: every default satisfies its own rule (the schema validates itself)',
      run: (ctx) => {
        const config = { ...schemaDefaults(), brand: { id: 'mini', name: 'MiniCo' } };

        ctx.expect(validateConfig(config).errors).toEqual([]);
      },
    },

    {
      name: 'schemaDefaults: a target overlays its OWN refinements on the shared set',
      run: (ctx) => {
        ctx.expect(schemaDefaults('web').marketing.prune.enabled, 'the shared set always applies').toBe(true);

        // Each target's own defaults, never another target's: the rules overlay the
        // same top-level namespace, so `categories` is the extension's answer and a
        // web resolve must not carry it.
        for (const [target, rules] of Object.entries(TARGET_SCHEMAS)) {
          const defaults = schemaDefaults(target);

          for (const rule of rules.filter((entry) => Object.prototype.hasOwnProperty.call(entry, 'default'))) {
            ctx.expect(rule.path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), defaults), `targets.${target}.${rule.path} default did not land`).toEqual(rule.default);
          }
        }

        ctx.expect(schemaDefaults('web').categories, "a target never inherits a sibling's refinements").toBe(undefined);
        ctx.expect(schemaDefaults('extension').categories, 'the AMO default a first Firefox publish lists under (#884)').toEqual(['alerts-updates']);
      },
    },

    // ─── The merge chain's lowest layer ───

    {
      name: 'loadConfig: schema defaults are the LOWEST layer — a brand value beats them',
      run: (ctx) => {
        const root = makeBrand('defaults-lowest', `{
  brand: { id: 'mini', name: 'MiniCo' },
  marketing: { prune: { enabled: false } },
  targets: { web: { type: 'web' } },
}
`);
        cleanup(ctx, root);

        const { config } = loadConfig(root, 'web');

        ctx.expect(config.marketing.prune.enabled, 'the brand file wins').toBe(false);
        ctx.expect(config.marketing.campaigns.enabled, 'the untouched default still lands').toBe(true);
        ctx.expect(config.repo, 'a brand that declares no repo block resolves none (#883)').toBe(undefined);
      },
    },

    {
      name: 'loadConfig: framework defaults still layer ON TOP of the schema defaults',
      run: (ctx) => {
        const root = makeBrand('defaults-framework', `{
  brand: { id: 'mini', name: 'MiniCo' },
  targets: { web: { type: 'web' } },
}
`);
        cleanup(ctx, root);

        const { config } = loadConfig(root, 'web', { defaults: { marketing: { prune: { enabled: false } } } });

        ctx.expect(config.marketing.prune.enabled, 'a genuine framework difference overrides the schema default').toBe(false);
      },
    },

    // ─── translation.include (#858) ───

    // Ian 2026-09-13: the translation route list is an INCLUDE list of globs now,
    // and its framework answer lives in the DEFAULTS layer like every other
    // default. A brand list REPLACES it: arrays replace at every level of the
    // merge chain (src/merge.js), so no brand ever inherits half of it.
    {
      name: '#858: `translation.include` defaults to everything but the blog, in the defaults layer',
      run: (ctx) => {
        ctx.expect(schemaDefaults().translation.include).toEqual(['**', '!blog/**']);
        ctx.expect(schemaDefaults('web').translation.include).toEqual(['**', '!blog/**']);
      },
    },

    {
      name: '#858: the include default RESOLVES but is never materialized into a brand file',
      run: (ctx) => {
        // A framework presentation fact (#793): writing it into every brand config
        // would hand each one a copy to drift from the framework's own answer.
        const rule = SHARED_SCHEMA.find((entry) => entry.path === 'translation.include');

        ctx.expect(rule.materialize).toBe(false);

        const block = missingDefaults({ brand: { id: 'mini' } }).find((entry) => entry.path === 'translation');
        ctx.expect(block, 'the translation block still materializes').toBeTruthy();
        ctx.expect(block.value.include, 'but never with the include list inside it').toBe(undefined);
      },
    },

    {
      name: '#858: a brand include list REPLACES the default rather than merging with it',
      run: (ctx) => {
        const root = makeBrand('translation-include', `{
  brand: { id: 'mini', name: 'MiniCo' },
  translation: { languages: ['es'], include: ['docs/**'] },
  targets: { web: { type: 'web' } },
}
`);
        cleanup(ctx, root);

        const { config } = loadConfig(root, 'web');

        ctx.expect(config.translation.include, 'the brand list wins whole').toEqual(['docs/**']);
      },
    },

    // ─── missingDefaults (the heal list) ───

    {
      name: 'missingDefaults: reports the HIGHEST missing branch, once',
      run: (ctx) => {
        const missing = missingDefaults({ brand: { id: 'mini', name: 'MiniCo' } });
        const paths = missing.map((entry) => entry.path);

        ctx.expect(paths.includes('marketing'), 'the whole missing section materializes as one block').toBeTruthy();
        ctx.expect(!paths.some((dotted) => dotted.startsWith('marketing.')), 'never a second edit inside the block it just added').toBeTruthy();

        const marketing = missing.find((entry) => entry.path === 'marketing');
        ctx.expect(marketing.value.prune.enabled).toBe(true);
      },
    },

    {
      name: 'defaultComments: every defaulted key and the containers above it are documented',
      run: (ctx) => {
        const comments = defaultComments();

        ctx.expect(comments['marketing.prune.enabled']).toMatch(/ON by default/);
        ctx.expect(comments.marketing, 'the container a materialized block lands at is documented too').toMatch(/\S/);
        ctx.expect(comments['brand.id'], 'a key with no default is never written, so it needs no comment').toBe(undefined);
      },
    },

    {
      name: 'missingDefaults: an existing block keeps its values and gains only what it lacks',
      run: (ctx) => {
        const missing = missingDefaults({
          brand: { id: 'mini', name: 'MiniCo' },
          marketing: { campaigns: { enabled: false } },
        });
        const paths = missing.map((entry) => entry.path);

        ctx.expect(!paths.includes('marketing'), 'the section is present — never rewritten whole').toBeTruthy();
        ctx.expect(!paths.includes('marketing.campaigns.enabled'), 'an authored value is never overwritten').toBeTruthy();
        ctx.expect(paths.includes('marketing.newsletter'), 'the missing sibling block is named').toBeTruthy();
        ctx.expect(paths.includes('marketing.prune'), 'the new subsystem appears on the next run').toBeTruthy();

        const prune = missing.find((entry) => entry.path === 'marketing.prune');
        ctx.expect(prune.value).toEqual({ enabled: true });
      },
    },

    {
      name: 'missingDefaults: a block the brand deliberately switched off is left alone',
      run: (ctx) => {
        // `marketing: false` is an authored value, not a hole to fill — diving into
        // it would clobber the brand's own decision.
        const paths = missingDefaults({ brand: { id: 'mini' }, marketing: false }).map((entry) => entry.path);

        ctx.expect(!paths.some((dotted) => dotted.startsWith('marketing')), 'nothing is written under an authored non-object').toBeTruthy();
      },
    },

    {
      name: 'missingDefaults: a fully materialized config has nothing left to heal',
      run: (ctx) => {
        const config = { ...schemaDefaults(), brand: { id: 'mini', name: 'MiniCo' } };

        ctx.expect(missingDefaults(config)).toEqual([]);
      },
    },

    {
      name: '#793: the connections defaults carry a card for each packaged provider',
      run: (ctx) => {
        const connections = schemaDefaults().connections;
        const packaged = fs.readdirSync(PACKAGED_PROVIDERS_DIR)
          .filter((file) => file.endsWith('.js'))
          .map((file) => path.basename(file, '.js'));

        ctx.expect(packaged.length > 0, `the provider files are where this test reads them: ${PACKAGED_PROVIDERS_DIR}`).toBeTruthy();
        ctx.expect(Object.keys(connections).sort(), 'one card per provider file @omega.js/backend ships, no more and no fewer').toEqual(packaged.sort());

        for (const [provider, entry] of Object.entries(connections)) {
          ctx.expect(entry.name, `${provider} names itself`).toBeTruthy();
          ctx.expect(entry.description, `${provider} carries the line under its card`).toBeTruthy();
          ctx.expect(entry.enabled, `${provider} is OFF until a brand turns it on — a card with no client id could connect nothing`).toBe(false);
          // The logo is a mark NAME (@omega.js/web draws it inline), never a URL: the
          // CDN files the old template rows pointed at 404
          ctx.expect(!entry.logo.includes('/'), `${provider}'s logo is a mark name, not a path: ${entry.logo}`).toBeTruthy();
          ctx.expect(!entry.logo.includes(':'), `${provider}'s logo is a mark name, not a url: ${entry.logo}`).toBeTruthy();
        }
      },
    },

    {
      name: '#793: the validator accepts the connections defaults, and a brand overrides them per key',
      run: (ctx) => {
        // The section is FREE-FORM (a brand ships providers the schema cannot know),
        // so the defaults have to pass the same validation a brand's own entries do
        const defaults = { ...schemaDefaults(), brand: { id: 'mini', name: 'MiniCo' } };

        ctx.expect(validateConfig(defaults).errors, 'the packaged table validates').toEqual([]);

        const root = makeBrand('connections-defaults', `{
  brand: { id: 'mini', name: 'MiniCo' },
  connections: {
    google: { enabled: true },
    twitch: { enabled: true, logo: 'https://cdn.example.com/twitch.svg' },
    'house-sso': { enabled: true, name: 'House SSO', logo: 'house' },
  },
  targets: { web: { type: 'web' } },
}
`);
        cleanup(ctx, root);

        const { config } = loadConfig(root, 'web');

        ctx.expect(config.connections.google.enabled, 'the brand turns a packaged provider on').toBe(true);
        ctx.expect(config.connections.google.name, 'and gets the packaged card with nothing else declared').toBe('Google');
        ctx.expect(config.connections.google.logo, 'including the mark that ships in @omega.js/web').toBe('google');
        ctx.expect(config.connections.google.description, 'and the line under it').toBeTruthy();

        ctx.expect(config.connections.twitch.logo, "a brand's own logo wins, per key").toBe('https://cdn.example.com/twitch.svg');
        ctx.expect(config.connections.twitch.name, 'while the keys it did not write still come from the defaults').toBe('Twitch');

        ctx.expect(config.connections['house-sso'].name, "a brand's own provider is untouched by any of it").toBe('House SSO');
        ctx.expect(config.connections.kick.enabled, 'and a packaged provider the brand never named stays off').toBe(false);

        ctx.expect(validateConfig(config, { target: 'web' }).errors, 'the resolved web config validates').toEqual([]);
      },
    },

    // ─── materialize: false — a default that resolves but is never written ───

    {
      name: '#793: a `materialize: false` default feeds resolution and is never written into a brand file',
      run: (ctx) => {
        // Framework PRESENTATION, not an owner decision: the connection cards' names,
        // logos and descriptions belong to the framework, and a copy in every brand's
        // omega.json5 is a copy that drifts. It resolves like any other default…
        ctx.expect(schemaDefaults().connections.google.name).toBe('Google');

        // …and the heal list never names it
        const paths = missingDefaults({ brand: { id: 'mini', name: 'MiniCo' } }).map((entry) => entry.path);

        ctx.expect(!paths.includes('connections'), `the block is never materialized: ${paths.join(', ')}`).toBeTruthy();
        ctx.expect(!paths.some((dotted) => dotted.startsWith('connections')), 'nor any key inside it').toBeTruthy();
        ctx.expect(paths.includes('marketing'), 'while an ordinary defaulted block still heals').toBeTruthy();

        // A block that is never written needs no guiding comment either
        ctx.expect(defaultComments().connections, 'and it carries no materialization comment').toBe(undefined);

        const rule = SHARED_SCHEMA.find((entry) => entry.path === 'connections');

        ctx.expect(rule.materialize, 'the flag lives on the rule, beside the default it governs').toBe(false);
      },
    },

    {
      name: 'edge.providers.cloudflare.webAnalytics.enabled resolves true and is never written into a brand file',
      run: (ctx) => {
        const root = makeBrand('web-analytics', `{
  brand: { id: 'mini', name: 'MiniCo', url: 'https://mini.test' },
  edge: { providers: { cloudflare: { zone: 'zone-1' } } },
  targets: { web: { type: 'web' } },
}
`);
        cleanup(ctx, root);

        ctx.expect(loadConfig(root, 'web').config.edge.providers.cloudflare.webAnalytics.enabled).toBe(true);

        // The heal writes every missing default through the editor; this one is not among them
        const file = path.join(root, 'config', 'omega.json5');
        const raw = JSON5.parse(fs.readFileSync(file, 'utf8'));
        writeConfigValues(root, Object.fromEntries(missingDefaults(raw).map((entry) => [entry.path, entry.value])));

        ctx.expect(fs.readFileSync(file, 'utf8')).not.toMatch(/webAnalytics/);
      },
    },

    {
      name: '#793: a brand that authored a connections block still heals its OTHER holes',
      run: (ctx) => {
        const paths = missingDefaults({
          brand: { id: 'mini', name: 'MiniCo' },
          connections: { google: { enabled: true } },
        }).map((entry) => entry.path);

        ctx.expect(!paths.some((dotted) => dotted.startsWith('connections')), 'the framework never fills in the rest of a brand\'s connections').toBeTruthy();
        ctx.expect(paths.includes('marketing'), 'and the ordinary blocks are unaffected').toBeTruthy();
      },
    },

    {
      name: 'planMerge: a path the present config lacks is added at its highest missing point, a differing authored value is kept',
      run: (ctx) => {
        const incoming = { brand: { id: 'sample', url: 'https://sample.test' }, socials: { twitter: 'sample' }, theme: { id: 'classy' } };
        const present = { brand: { id: 'realbrand' }, theme: 'custom', socials: { twitter: 'sample' } };

        const { added, kept } = planMerge(incoming, present);

        ctx.expect(added).toEqual([{ path: 'brand.url', value: 'https://sample.test' }]);
        ctx.expect(kept, 'an equal value is neither added nor kept').toEqual([
          { path: 'brand.id', value: 'realbrand', incoming: 'sample' },
          { path: 'theme', value: 'custom', incoming: { id: 'classy' } },
        ]);
      },
    },

    {
      name: 'setAtPath creates intermediate objects and sets leaves',
      run: (ctx) => {
        const obj = { a: { b: 1 } };
        setAtPath(obj, 'a.c.d', 'x');
        setAtPath(obj, 'a.b', 2);
        ctx.expect(obj).toEqual({ a: { b: 2, c: { d: 'x' } } });
      },
    },
  ],
});

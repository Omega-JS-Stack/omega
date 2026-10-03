// Tests for the workspace `defaults` ensure op — the self-healing config
// ([#478](https://github.com/Omega-JS-Stack/omega/issues/478)): every manage
// run materializes the schema-defaulted blocks a brand's omega.json5 is
// missing, with the schema's own description as the guiding comment, and never
// rewrites a value the brand authored. Real files in a temp dir, no mocks.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');

const defaultsOp = require('../src/services/workspace/ensure/defaults.js');

// A hand-authored brand config: comments and blank lines are load-bearing,
// marketing is switched OFF against the schema default, and whole sections
// (search, monitoring, …) have never been written.
const AUTHORED = `// Fixture Brand — hand-edited
{
  brand: {
    id: 'fixture-brand', // single quotes, stay single
    name: "Fixture Brand",
  },

  /* marketing — the brand disabled pruning on purpose */
  marketing: {
    prune: {
      enabled: false,
    },
  },

  targets: {
    web: { type: 'web' },
  },
}
`;

function makeBrand(contents = AUTHORED) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-config-defaults-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), contents);
  return root;
}

const configPath = (root) => path.join(root, 'config', 'omega.json5');
const read = (root) => fs.readFileSync(configPath(root), 'utf8');

module.exports = defineCases({
  type: 'group',
  description: 'config-defaults',
  tests: [
    {
      name: 'defaults: a config missing a schema-defaulted block gains it, comments intact',
      run: async (ctx) => {
        const root = makeBrand();

        const result = await defaultsOp({ brandRoot: root, options: {} });

        const source = read(root);
        const parsed = JSON5.parse(source);

        ctx.expect(parsed.marketing.campaigns.enabled, 'the missing sibling block materialized').toBe(true);
        ctx.expect(parsed.search.providers.searchConsole.enabled, 'a whole missing section materialized').toBe(true);
        ctx.expect(parsed.search.providers.searchConsole.sitemapPaths).toEqual(['/sitemap.xml']);

        // Every authored byte survives: comments, quote style, blank lines
        ctx.expect(source.includes('// Fixture Brand — hand-edited')).toBeTruthy();
        ctx.expect(source.includes("id: 'fixture-brand', // single quotes, stay single")).toBeTruthy();
        ctx.expect(source.includes('/* marketing — the brand disabled pruning on purpose */')).toBeTruthy();

        // Every materialized key carries the schema's own guiding comment, wrapped
        // at its own indent
        ctx.expect(source).toMatch(/\n {8}\/\/ false = skip sitemap submission to Google Search Console\.\n {8}submitSitemap: true,/);
        ctx.expect(source).toMatch(/\/\/ Role-level switch for email marketing[\s\S]*?\n {6}enabled: true,/);

        ctx.expect(result.output.defaults.materialized.includes('search'), 'the run output names what was healed').toBeTruthy();
      },
    },

    {
      name: '#793: a resolution-only default (connections) is never written into the brand file',
      run: async (ctx) => {
        // `materialize: false` on the schema rule: the connection cards' presentation
        // resolves from the framework and is never copied into a brand's config,
        // where it would drift from the framework it came from.
        const root = makeBrand();

        const result = await defaultsOp({ brandRoot: root, options: {} });

        const source = read(root);
        const parsed = JSON5.parse(source);

        ctx.expect(parsed.connections, `the brand file gained no connections block: ${source}`).toBe(undefined);
        ctx.expect(!source.includes('Per-provider user-connection settings'), 'nor its schema description as a comment').toBeTruthy();
        ctx.expect(!result.output.defaults.materialized.includes('connections'), 'and the run never claims to have healed one').toBeTruthy();
        ctx.expect(result.output.defaults.materialized.includes('search'), 'while the ordinary blocks still materialize').toBeTruthy();
      },
    },

    {
      name: '#883: the repo block is never materialized, because its presence IS the switch',
      run: async (ctx) => {
        // A defaulted `repo: { provider: 'github' }` would say every brand hosts its
        // source somewhere, and the repo service would run for a brand that declared
        // nothing.
        const root = makeBrand();

        const result = await defaultsOp({ brandRoot: root, options: {} });

        ctx.expect(JSON5.parse(read(root)).repo).toBe(undefined);
        ctx.expect(!result.output.defaults.materialized.includes('repo')).toBeTruthy();
      },
    },

    {
      name: '#943: a target-only default (web meta.index) lands under targets.<name>, where loadConfig reads it',
      run: async (ctx) => {
        const { missingDefaults, deepMerge, undeclaredAuthoredPaths } = require('@omega.js/config');
        const root = makeBrand();

        const result = await defaultsOp({ brandRoot: root, options: {} });

        const parsed = JSON5.parse(read(root));
        ctx.expect(parsed.targets.web.meta.index, 'the web refinement materialized in the web entry').toBe(true);
        ctx.expect(parsed.meta, 'never at the root, which the strict schema reads as shared').toBe(undefined);
        ctx.expect(undeclaredAuthoredPaths(parsed), 'the healed file still validates').toEqual([]);
        ctx.expect(result.output.defaults.materialized.includes('targets.web.meta')).toBeTruthy();

        const { targets, ...shared } = parsed;
        ctx.expect(missingDefaults(deepMerge(shared, targets.web), 'web'), 'the web view carries every default').toEqual([]);
        ctx.expect(await defaultsOp({ brandRoot: root, options: {} }), 'and a second run is a no-op').toBe(null);
      },
    },

    {
      name: '#943: a target that already answers its own default is left alone',
      run: async (ctx) => {
        const root = makeBrand(AUTHORED.replace("web: { type: 'web' },", "web: { type: 'web', meta: { index: false } },"));

        await defaultsOp({ brandRoot: root, options: {} });

        ctx.expect(JSON5.parse(read(root)).targets.web.meta.index).toBe(false);
      },
    },

    {
      name: 'defaults: a value the brand authored is never overwritten',
      run: async (ctx) => {
        const root = makeBrand();

        await defaultsOp({ brandRoot: root, options: {} });

        const parsed = JSON5.parse(read(root));
        ctx.expect(parsed.marketing.prune.enabled, 'the brand\'s own decision stands').toBe(false);
        ctx.expect(parsed.brand.id).toBe('fixture-brand');
      },
    },

    {
      name: 'defaults: marketing.prune.enabled materializes TRUE for a brand that never wrote it',
      run: async (ctx) => {
        const root = makeBrand(`{
  brand: { id: 'fixture-brand', name: 'Fixture Brand' },
}
`);

        await defaultsOp({ brandRoot: root, options: {} });

        ctx.expect(JSON5.parse(read(root)).marketing.prune.enabled).toBe(true);
      },
    },

    {
      name: 'defaults: a second run heals nothing and leaves the file byte-identical',
      run: async (ctx) => {
        const root = makeBrand();

        await defaultsOp({ brandRoot: root, options: {} });
        const healed = read(root);

        const second = await defaultsOp({ brandRoot: root, options: {} });

        ctx.expect(read(root), 'not one byte rewritten').toBe(healed);
        ctx.expect(second, 'a converged config is a plain no-op').toBe(null);
      },
    },

    {
      name: 'defaults: a dry run reports the blocks and writes nothing',
      run: async (ctx) => {
        const root = makeBrand();
        const before = read(root);

        const result = await defaultsOp({ brandRoot: root, options: { dryRun: true } });

        ctx.expect(read(root), 'a dry run never touches the file').toBe(before);
        ctx.expect(result.output.defaults.planned.includes('search')).toBeTruthy();
      },
    },

    {
      name: 'defaults: a brand root with no config/omega.json5 steps aside',
      run: async (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-config-defaults-none-'));

        ctx.expect(await defaultsOp({ brandRoot: root, options: {} })).toBe(null);
      },
    },

    {
      name: 'defaults op is registered in the workspace OPERATIONS, right after config',
      run: (ctx) => {
        const { OPERATIONS } = require('../src/config.js');
        const names = OPERATIONS.workspace.map((op) => op.name);

        ctx.expect(OPERATIONS.workspace.some((op) => op.name === 'defaults' && op.ensure === true)).toBeTruthy();
        ctx.expect(names.indexOf('defaults'), 'heals only after the config is known sane').toBe(names.indexOf('config') + 1);
      },
    },

    {
      name: 'manager DEFAULTS derive from the schema — one home per default',
      run: (ctx) => {
        const { DEFAULTS } = require('../src/config.js');
        const { schemaDefaults } = require('@omega.js/config');

        // The schema answer reaches every manager read site through DEFAULTS…
        ctx.expect(DEFAULTS.search.providers.searchConsole.enabled).toBe(schemaDefaults().search.providers.searchConsole.enabled);
        ctx.expect(DEFAULTS.marketing.prune.enabled).toBe(true);
        ctx.expect(DEFAULTS.inbound.chat.providers.chatsy.enabled).toBe(true);
        const schema = schemaDefaults();
        for (const name of ['enabled', 'server.enabled', 'assets.enabled', 'payment.enabled', 'seo.enabled', 'certificates.enabled', 'account.enabled']) {
          const read = (config) => name.split('.').reduce((node, key) => node?.[key], config);
          ctx.expect(read(schema), `${name} is a schema default`).toBe(true);
          ctx.expect(read(DEFAULTS), `${name} reaches the manager from its schema default`).toBe(true);
        }

        ctx.expect(DEFAULTS.edge.providers.cloudflare.settings.ssl).toBe(schema.edge.providers.cloudflare.settings.ssl);

        // …and the service-owned data the schema does not declare still lives here
        ctx.expect(DEFAULTS.analytics.providers.google.currency).toBe('USD');
      },
    },

    {
      name: 'no key in MANAGER_DEFAULTS has a schema default',
      run: (ctx) => {
        const { MANAGER_DEFAULTS } = require('../src/config.js');
        const { schemaDefaults, TARGETS } = require('@omega.js/config');
        const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
        const leaves = (node, prefix) => Object.entries(node).flatMap(([key, value]) => {
          const dotted = prefix ? `${prefix}.${key}` : key;
          return isObject(value) && Object.keys(value).length > 0 ? leaves(value, dotted) : [dotted];
        });

        // A schema default at the leaf, above it, or below an empty manager leaf is a second home
        const defaulted = (defaults, dotted) => {
          let node = defaults;
          for (const name of dotted.split('.')) {
            if (!isObject(node) || !(name in node)) return false;
            node = node[name];
            if (!isObject(node)) return true;
          }
          return true;
        };

        const views = [schemaDefaults(), ...TARGETS.map((target) => schemaDefaults(target))];
        const twins = leaves(MANAGER_DEFAULTS, '').filter((dotted) => views.some((defaults) => defaulted(defaults, dotted)));

        ctx.expect(twins, 'each of these defaults has two homes: the schema and MANAGER_DEFAULTS').toEqual([]);
      },
    },
  ],
});

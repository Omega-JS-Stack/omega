/**
 * The three namespaces (#607): a page overrides omega.json5 under a `config:`
 * parent, `meta` is page machinery that never appears in the config file, and
 * the `site` global keeps build facts only.
 *
 * Before this, a page restating a config section bare merged into the same
 * flat `resolved` tree the config seeded — `theme:` in frontmatter silently
 * overrode `theme` in omega.json5, and nothing else did, so the two namespaces
 * drifted with no signal either way.
 *
 * The membership rule runs BOTH ways (Ian's 2026-08-26 addendum): in the
 * config file means under `config:`, and not in the config file means not
 * allowed under `config:`. A typo there — `config: { them: … }` — would
 * otherwise merge a key nothing reads and change nothing, silently.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { configureOmega } = require('../src/index.js');
const { SITE_FACT_KEYS } = require('../src/config-sections.js');
const { buildSite, readBuildJson, readPageConfig, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

// A brand that runs the chat widget — the page-level override under test
// switches it off for ONE page.
const chatOn = {
  ...bareData,
  inbound: { chat: { providers: { chatsy: { enabled: true, agentId: 'agent-607' } } } },
};

/**
 * A one-page consumer whose index.md carries the given frontmatter lines.
 * @param {string[]} frontmatter
 * @returns {{ tmp: string, consumerDir: string }}
 */
function makeConsumer(frontmatter) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-pageconfig-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
    '---',
    'layout: blueprint/index',
    'permalink: /',
    ...frontmatter,
    '---',
    '',
  ].join('\n'));
  return { tmp, consumerDir };
}

module.exports = defineCases({
  type: 'group',
  description: 'page-config-overrides',
  tests: [
    {
      name: 'a page `config:` block overrides the brand config for that page only',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'config:',
          '  inbound:',
          '    chat:',
          '      providers:',
          '        chatsy:',
          '          enabled: false',
        ]);
        try {
          const pages = await buildSite(consumerDir, chatOn, { environment: 'development' }, 'page-config-chat-off');
          const html = pages.get('/');
          ctx.expect(html, 'page built').toBeTruthy();
          ctx.expect(!html.includes('href="https://chatsy.ai"'), 'the page config switched the chat preconnect off').toBeTruthy();
          // The site's snapshot plus THIS page's `config:` delta, the one line
          // head.html emits after the loader tag (#743).
          const line = html.match(/Object\.assign\(self\.OMEGA_BUILD_JSON\.config,\s*(\{.*?\})\s*\);/s);
          ctx.expect(line && line[1].includes('"inbound"'), 'the page emits its own delta line, naming the section it changed').toBeTruthy();
          const chatsy = readPageConfig(pages, html).inbound.chat.providers.chatsy;
          ctx.expect(chatsy.enabled, 'the page delta carries the page value').toBe(false);
          ctx.expect(chatsy.agentId, 'the rest of the brand chat block still merges underneath').toBe('agent-607');
          ctx.expect(readBuildJson(pages).config.inbound.chat.providers.chatsy.enabled, 'and the SITE snapshot is untouched: the delta is this page\'s alone').toBe(true);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'with no page `config:`, the brand config stands',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([]);
        try {
          const pages = await buildSite(consumerDir, chatOn, { environment: 'development' }, 'page-config-chat-on');
          const html = pages.get('/');
          ctx.expect(html.includes('href="https://chatsy.ai"'), 'the brand chat block still renders the preconnect').toBeTruthy();
          // A page that changes nothing about a section emits no delta for it: the
          // line after the loader tag names only what its own view really differs on
          // (this page's layout chain moves `theme`, and nothing else).
          const delta = html.match(/Object\.assign\(self\.OMEGA_BUILD_JSON\.config,\s*(\{.*?\})\s*\);/s);
          ctx.expect(!delta || !delta[1].includes('"inbound"'), 'no page block, no chat delta').toBeTruthy();
          ctx.expect(readPageConfig(pages, html).inbound.chat.providers.chatsy.enabled, 'the snapshot carries the brand value').toBe(true);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'restating a config section BARE in a page is a build error naming the file and the key',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'theme:',
          '  main:',
          '    class: "smuggled"',
        ]);
        try {
          await ctx.expect((() => buildSite(consumerDir, bareData, { environment: 'development' }, 'page-config-bare-fail'))()).rejects.toThrow((error) => {
              // Eleventy wraps a preprocessor throw — the engine's message is down
              // the originalError/cause chain.
              const parts = [];
              for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
              const message = parts.join(' | ');
              ctx.expect(message, 'the error names the file').toMatch(/index\.md/);
              ctx.expect(message, 'the error names the key').toMatch(/`theme`/);
              ctx.expect(message, 'the error names the lane that replaced it').toMatch(/config:/);
              return true;
            });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a key under `config:` that is not a config section is a build error naming the file and the key',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'config:',
          '  headline: "not a section"',
        ]);
        try {
          await ctx.expect((() => buildSite(consumerDir, bareData, { environment: 'development' }, 'page-config-strict-fail'))()).rejects.toThrow((error) => {
              const parts = [];
              for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
              const message = parts.join(' | ');
              ctx.expect(message, 'the error names the file').toMatch(/index\.md/);
              ctx.expect(message, 'the error names the key').toMatch(/`headline`/);
              ctx.expect(message, 'the error names what `config:` holds').toMatch(/omega\.json5/);
              return true;
            });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    ...(() => {
      const cases = [];
      // A `config:` that is not a MAP of sections is the loudest version of the same
      // mistake: `deepMerge` lets a null/array/scalar REPLACE the seeded config, so
      // resolved.config for that page stops being the brand config entirely and
      // every read under it renders empty. Each spelling fails naming the shape.
      for (const { label, lines, shape } of [
        { label: 'an empty key', lines: ['config:'], shape: /empty|null/i },
        { label: 'a list', lines: ['config:', '  - theme'], shape: /array/ },
        { label: 'a scalar', lines: ['config: "theme"'], shape: /string/ },
      ]) {
        cases.push({
          name: `\`config:\` as ${label} is a build error naming the file and the shape`,
          run: async (ctx) => {
            const { tmp, consumerDir } = makeConsumer(lines);
            try {
              await ctx.expect((() => buildSite(consumerDir, bareData, { environment: 'development' }, `page-config-shape-${label.replace(/\s+/g, '-')}`))()).rejects.toThrow((error) => {
                  const parts = [];
                  for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
                  const message = parts.join(' | ');
                  ctx.expect(message, 'the error names the file').toMatch(/index\.md/);
                  ctx.expect(message, 'the error names the block').toMatch(/`config:`/);
                  ctx.expect(message, 'the error names the shape it received').toMatch(shape);
                  return true;
                });
            } finally {
              fs.rmSync(tmp, { recursive: true, force: true });
            }
          },
        });
      }
      return cases;
    })(),

    {
      name: 'a brand section with no schema rule is still config — `config:` takes it',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'config:',
          '  brandOwn:',
          '    label: "page value"',
        ]);
        const withOwnSection = { ...bareData, brandOwn: { label: 'brand value', kept: 'yes' } };
        try {
          const pages = await buildSite(consumerDir, withOwnSection, { environment: 'development' }, 'page-config-brand-own');
          ctx.expect(pages.get('/'), 'the page built — a key the brand config carries is a section').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '`meta` is PAGE machinery — omega.json5 has no meta section, so the head falls back to the brand',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'meta:',
          '  title: "Page title wins"',
        ]);
        // A leftover config `meta` block (the validator now refuses one) reaches
        // NOTHING: the engine seeds the walk from frontmatter alone.
        const leftover = { ...bareData, meta: { title: 'Config meta title', description: 'Config meta description' } };
        try {
          const pages = await buildSite(consumerDir, leftover, { environment: 'development' }, 'page-config-meta-bare');
          const html = pages.get('/');
          ctx.expect(html.includes('<title>Page title wins</title>'), 'the page meta.title is the title').toBeTruthy();
          ctx.expect(!html.includes('Config meta description'), 'no config meta section feeds the walk').toBeTruthy();
          ctx.expect(html.includes(`content="${bareData.brand.description}"`), 'the description falls back to brand.description').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'with no page meta at all, the head is the brand — brand.name and brand.description',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([]);
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'page-config-meta-site');
          const html = pages.get('/');
          ctx.expect(html.includes(`<title>${bareData.brand.name}</title>`), 'brand.name is the site-wide title default').toBeTruthy();
          ctx.expect(html.includes(`content="${bareData.brand.description}"`), 'brand.description is the site-wide description default').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '`resolved.config` is the WHOLE merged config, with the page block on top',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'config:',
          '  brandOwn:',
          '    label: "page value"',
        ]);
        fs.appendFileSync(path.join(consumerDir, 'pages', 'index.md'), [
          '<p id="own">{{ resolved.config.brandOwn.label }}</p>',
          '<p id="kept">{{ resolved.config.brandOwn.kept }}</p>',
          '<p id="deep">{{ resolved.config.theme.id }}</p>',
          '<p id="brand">{{ resolved.config.brand.name }}</p>',
          '',
        ].join('\n'));
        const withOwnSection = { ...bareData, brandOwn: { label: 'brand value', kept: 'yes' } };
        try {
          const pages = await buildSite(consumerDir, withOwnSection, { environment: 'development' }, 'page-config-whole');
          const html = pages.get('/');
          ctx.expect(html, 'the page block wins its own key').toMatch(/id="own">page value</);
          ctx.expect(html, 'every sibling key of the overridden section is still there').toMatch(/id="kept">yes</);
          ctx.expect(html, 'a section the page never named rides along').toMatch(/id="deep">classy</);
          ctx.expect(html, 'the whole config is under it, not a filtered subset').toMatch(new RegExp(`id="brand">${bareData.brand.name}<`));
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'the `site` global carries BUILD FACTS only — every config section moved to resolved.config',
      run: (ctx) => {
        const globals = {};
        const noop = () => {};
        const stub = {
          setLiquidOptions: noop,
          setIncludesDirectory: noop,
          amendLibrary: noop,
          addGlobalData: (name, value) => { globals[name] = value; },
          addPreprocessor: noop,
          addFilter: noop,
          addUrlTransform: noop,
          addTransform: noop,
          addTemplate: noop,
          addCollection: noop,
          addWatchTarget: noop,
          addPlugin: (plugin, ...args) => plugin(stub, ...args),
          on: noop,
          ignores: new Set(),
        };
        configureOmega(stub, {
          consumerDir: BARE,
          siteData: { ...bareData, analytics: { providers: { google: { id: 'G-1' } } }, payment: { products: [] } },
          environment: 'development',
          assetManifest: { js: { pages: {} }, css: { pages: {}, layouts: {} } },
        });

        const strays = Object.keys(globals.site).filter((key) => !SITE_FACT_KEYS.includes(key));
        ctx.expect(strays, `site.${strays.join(', site.')} is config, not a build fact — it belongs in resolved.config `
          + '(a collection this brand declares is a legitimate site key too, #593 — the bare fixture declares none)').toEqual([]);
      },
    },
  ],
});

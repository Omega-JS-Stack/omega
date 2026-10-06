/**
 * The meta-only frontmatter guard (Ian's rule, 2026-07-19: "NOTHING EVEN
 * TRIES TO CONSUME FRONTMATTER"; softened same day: no build-fail): content
 * keys in a consumer page's frontmatter are STRIPPED from the cascade with a
 * warning — the build succeeds, but sections/components can never see the
 * values. The override lane doesn't silently work; it doesn't exist. Meta
 * keys (meta, schema), the `config:` override block (#607) and
 * plumbing (layout, permalink) stay legal, and collection docs (_posts/…) are
 * content entries the guard never touches. A config section restated BARE is
 * the one frontmatter mistake that FAILS the build — test/page-config-overrides.test.js.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

function makeConsumer(pageFrontmatter, layout = 'blueprint/index') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fmguard-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
    '---',
    `layout: ${layout}`,
    'permalink: /',
    ...pageFrontmatter,
    '---',
    '',
  ].join('\n'));
  return { tmp, consumerDir };
}

module.exports = defineCases({
  type: 'group',
  description: 'frontmatter-guard',
  tests: [
    {
      name: 'content keys in page frontmatter are stripped (never rendered) and warned about',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'hero:',
          '  headline: "Smuggled content"',
          'mission:',
          '  title: "Also smuggled"',
        ]);
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...parts) => warnings.push(parts.join(' '));
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'fm-guard-strip');
          const html = pages.get('/');
          ctx.expect(html, 'build succeeds — content keys are inert, not fatal').toBeTruthy();
          ctx.expect(!html.includes('Smuggled content'), 'frontmatter hero value never reaches the render').toBeTruthy();
          ctx.expect(!html.includes('Also smuggled'), 'frontmatter mission value never reaches the render').toBeTruthy();
          const warning = warnings.find((line) => line.includes('ignoring frontmatter content keys'));
          ctx.expect(warning, `build warns about the stripped keys: ${warnings.join(' | ')}`).toBeTruthy();
          ctx.expect(/hero/.test(warning) && /mission/.test(warning), 'warning lists the offending keys').toBeTruthy();
          ctx.expect(/section/.test(warning), 'warning points at section calls as the home').toBeTruthy();
        } finally {
          console.warn = originalWarn;
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    // #1 — `client` (the @omega.js/client settings blob, renamed from the legacy
    // `web_manager`) is a CONFIG section, so #607 moved it under the page's
    // `config:` parent: a page may still set it, and the value must survive to
    // resolved.config.client with the layout chain still merging underneath it.
    {
      name: 'a page may set `client` under `config:` — it reaches resolved.config.client, layout chain merged underneath',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'config:',
          '  client:',
          '    auth:',
          '      config:',
          '        policy: "authenticated"',
        ], 'blueprint/auth/signin');
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...parts) => warnings.push(parts.join(' '));
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'fm-guard-client');
          const html = pages.get('/');
          ctx.expect(html, 'page built').toBeTruthy();

          // The page's own `config:` delta after the loader tag is the emitted view
          // of resolved.config for this page (#607, #743).
          ctx.expect(/"policy":\s*"authenticated"/.test(html), 'page frontmatter client.auth.config.policy wins').toBeTruthy();
          ctx.expect(!/"policy":\s*"unauthenticated"/.test(html), 'the layout value is overridden, not appended').toBeTruthy();

          // …and the rest of the layout's client blob still merges underneath.
          ctx.expect(/"authenticated":\s*"\/"/.test(html), 'the signin layout\'s auth.config.redirects survives the page override').toBeTruthy();

          ctx.expect(!warnings.some((line) => line.includes('ignoring frontmatter content keys') && line.includes('client')), `client is not treated as smuggled content: ${warnings.join(' | ')}`).toBeTruthy();
        } finally {
          console.warn = originalWarn;
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    // #247 — a SHIPPED layout contract reads page frontmatter: the redirect
    // layout's `redirect.url` (documented in docs/web/index.md). It worked only
    // from defaults/ and _layouts/ (exempt from the /pages/ guard), so a
    // consumer's own page lost it silently — a redirect page bounced to site.url
    // instead of its target. (`prerender_icons` rode the same lane until #619
    // retired it: icons are native markup now, inlined at build.)
    {
      name: '#247: a consumer page keeps redirect through the guard',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'redirect:',
          '  url: "https://example.com/target"',
        ], 'modules/utilities/redirect');
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...parts) => warnings.push(parts.join(' '));
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'fm-guard-shipped-keys');
          const html = pages.get('/');
          ctx.expect(html, 'page built').toBeTruthy();

          ctx.expect(html.includes('data-url="https://example.com/target"'), 'the page redirect.url reaches the redirect config').toBeTruthy();
          ctx.expect(!html.includes(`data-url="${bareData.url}"`), 'the layout never falls back to site.url when the page names a target').toBeTruthy();
          ctx.expect(!warnings.some((line) => line.includes('ignoring frontmatter content keys')), `neither key is treated as smuggled content: ${warnings.join(' | ')}`).toBeTruthy();
        } finally {
          console.warn = originalWarn;
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'meta-only frontmatter (meta, schema) builds clean',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'meta:',
          '  title: "Legal meta"',
          'schema:',
          '  faq_page:',
          '    enabled: false',
        ]);
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'fm-guard-allow');
          ctx.expect(pages.get('/'), 'page built').toBeTruthy();
          ctx.expect(pages.get('/').includes('<title>Legal meta</title>'), 'meta.title consumed — meta is the sanctioned lane').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    // #564 retired the page-level `sitemap` block: the sitemap follows meta.index,
    // so a page still carrying it is stripped with the meta-only warning.
    {
      name: 'a retired sitemap block in page frontmatter is stripped and the warning names it',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer([
          'sitemap:',
          '  include: false',
        ]);
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...parts) => warnings.push(parts.join(' '));
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'fm-guard-sitemap');
          ctx.expect(pages.get('/'), 'build succeeds').toBeTruthy();
          const warning = warnings.find((line) => line.includes('ignoring frontmatter content keys'));
          ctx.expect(warning, `build warns about the stripped block: ${warnings.join(' | ')}`).toBeTruthy();
          ctx.expect(/sitemap/.test(warning), 'warning names sitemap').toBeTruthy();
        } finally {
          console.warn = originalWarn;
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});

/**
 * `meta:` frontmatter and the pagination alias (#544, found porting trusteroo).
 * Only `resolved.`/`page.`-prefixed refs used to defer to render time, so
 * `{{ brand_doc.name }}` under a `brand_doc` alias rendered EMPTY at cache time
 * and cached that — 280 generated brand pages shipped one nameless title. An
 * alias ref now defers like any other per-page ref; a meta ref whose root
 * nothing in the cascade defines fails the build loudly instead of caching an
 * empty render.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

const SHELL_LAYOUT = [
  '---',
  '---',
  '<h1>{{ resolved.meta.title }}</h1>',
  '<p id="desc">{{ resolved.meta.description }}</p>',
  '',
].join('\n');

function makeConsumer(metaTitle, extraMeta = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-metaalias-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(consumerDir, '_data'), { recursive: true });
  fs.mkdirSync(path.join(consumerDir, '_layouts'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, '_data', 'brands.json'), JSON.stringify([
    { name: 'Alpha', slug: 'alpha' }, { name: 'Beta', slug: 'beta' },
  ]));
  fs.writeFileSync(path.join(consumerDir, '_layouts', 'shell.html'), SHELL_LAYOUT);
  fs.writeFileSync(path.join(consumerDir, 'pages', 'brand.html'), [
    '---',
    'layout: shell',
    'pagination:',
    '  data: brands',
    '  size: 1',
    '  alias: brand_doc',
    'permalink: "/brands/{{ brand_doc.slug }}.html"',
    'meta:',
    `  title: "${metaTitle}"`,
    ...extraMeta,
    '---',
    '',
  ].join('\n'));
  return { tmp, consumerDir };
}

// Eleventy wraps a template error in its own; the message that matters is at
// the bottom of the originalError/cause chain.
const flatten = (error) => {
  const parts = [];
  for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message || String(node));
  return parts.join(' :: ');
};

module.exports = defineCases({
  type: 'group',
  description: 'meta-pagination-alias',
  tests: [
    {
      name: '#544: a meta ref rooted at the page\'s pagination alias defers and renders per page',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer('{{ brand_doc.name }} review');
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'meta-alias-defer');

          const alpha = pages.get('/brands/alpha');
          const beta = pages.get('/brands/beta');
          ctx.expect(alpha && beta, 'both generated pages built').toBeTruthy();

          ctx.expect(alpha.includes('<h1>Alpha review</h1>'), 'the first page names its own document').toBeTruthy();
          ctx.expect(beta.includes('<h1>Beta review</h1>'), 'and the second is not the first, cached').toBeTruthy();
          ctx.expect(!alpha.includes('<h1> review</h1>'), 'nothing ships the nameless title').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#544: an alias-titled page carries that title into the meta files too',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer('{{ brand_doc.name }} review');
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'meta-alias-metafiles');
          const pagesJson = pages.get('/pages.json');
          ctx.expect(pagesJson, 'the search index built').toBeTruthy();
          // A paginated template puts only its FIRST page in collections (Eleventy's
          // own default), so the index carries Alpha — and it carries the rendered
          // name, not the raw ref and not an empty title.
          ctx.expect(pagesJson.includes('"title": "Alpha review"'), 'omega_rendered renders the alias ref for the item it reads').toBeTruthy();
          ctx.expect(!pagesJson.includes('brand_doc'), 'no raw Liquid ships into the search index').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#544: a meta ref with an UNDEFINED root fails the build, naming the file and the ref',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer('{{ brand_dcoument.name }} review');
        try {
          await ctx.expect((() => buildSite(consumerDir, bareData, { environment: 'development' }, 'meta-alias-undefined'))()).rejects.toThrow((error) => {
              const message = flatten(error);
              ctx.expect(message, 'the failure names the file').toMatch(/brand\.html/);
              ctx.expect(message, 'and the ref that has no data').toMatch(/brand_dcoument/);
              return true;
            });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#544: legit empty optional values still pass',
      run: async (ctx) => {
        // `resolved.meta.keywords` is simply unset on the bare brand — an empty
        // OPTIONAL value, not an undefined root, and the build must not care.
        const { tmp, consumerDir } = makeConsumer('{{ brand_doc.name }} review', [
          '  description: "{{ resolved.meta.keywords }}"',
        ]);
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'meta-alias-optional');
          const alpha = pages.get('/brands/alpha');
          ctx.expect(alpha, 'the page built').toBeTruthy();
          ctx.expect(alpha.includes('<p id="desc"></p>'), 'the optional value renders empty, and that is fine').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});

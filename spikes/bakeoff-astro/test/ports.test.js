/**
 * A2 real-layout ports against the ports-site fixture — the Astro half of
 * the migration-cost dimension. The two real LAYOUTS (UJM classy contact,
 * sweet-saucy recipe + its adsense include) are full .astro rewrites; the
 * somiibo index is a content PAGE and runs VERBATIM through the Liquid
 * content pipeline (zero rewrite — that asymmetry is the headline Astro
 * finding). Assertions mirror bakeoff-eleventy/test/ports.test.js.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');

const SPIKE = path.resolve(__dirname, '..');
const PORTS = path.resolve(SPIKE, '..', 'bakeoff-shared', 'fixtures', 'ports-site');

const TEST_MANIFEST = {
  js: {},
  css: { theme: '/assets/css/theme-TEST.css' },
};

/**
 * Run astro build over the ports fixture and index the output by URL.
 * @returns {Promise<Map<string, string>>}
 */
async function buildPorts() {
  const outDir = path.join(SPIKE, '.omega', 'test-out-ports');

  fs.rmSync(path.join(SPIKE, '.astro'), { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(SPIKE, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(SPIKE, '.omega', 'asset-manifest.json'), JSON.stringify(TEST_MANIFEST));

  process.env.ASTRO_TELEMETRY_DISABLED = '1';
  process.env.OMEGA_CONSUMER = PORTS;
  delete process.env.OMEGA_THEME;

  const { build } = require('astro');
  await build({ root: SPIKE, outDir, logLevel: 'error' });

  const pages = new Map();
  for (const entry of fs.readdirSync(outDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const rel = path.relative(outDir, path.join(entry.parentPath, entry.name));
    const url = rel === '404.html' ? '/404.html' : `/${rel.replace(/index\.html$/, '')}`;
    pages.set(url, fs.readFileSync(path.join(outDir, rel), 'utf8'));
  }
  return pages;
}

let pages;
before(async () => {
  pages = await buildPorts();
});

test('real classy contact (.astro rewrite): site-templated default, fixed icon args, full sections', () => {
  const html = pages.get('/contact/');
  assert.ok(html, '/contact/ rendered');

  // The Liquid original's {{ site.brand.name }} layout default → ?? pattern
  assert.ok(html.includes('Have questions about PortsCo? Our support team is here to help you'),
    'site-templated hero.subheadline rendered');

  assert.ok(html.includes('Get in') && html.includes('touch'), 'hero headline + accent');
  assert.ok(html.includes('id="contact-form"'), 'contact form present');
  assert.ok(html.includes('Email support') && html.includes('Live chat'), 'contact methods rendered');

  assert.ok(html.includes('contactFaqAccordion'), 'FAQ accordion present');
  assert.strictEqual((html.match(/accordion-item/g) || []).length, 3, '3 FAQ items');

  assert.ok(html.includes('text-warning display-4'), 'stat icon color class interpolated');
  assert.ok(!html.includes('text-{{'), 'no raw Liquid left in classes');
});

test('real sweet-saucy recipe (.astro rewrite): grafted meta, uj_member vs real team doc, AdUnit component', () => {
  const html = pages.get('/recipes/the-best-brown-butter-chocolate-chip-cookies/');
  assert.ok(html, 'recipe page rendered');

  assert.ok(html.includes('<title>The Best Brown Butter Chocolate Chip Cookies Recipe - PortsCo</title>'),
    'page-templated meta.title grafted onto resolved');

  assert.ok(html.includes('The Best Brown Butter Chocolate Chip Cookies Recipe</h1>'), 'hero h1');
  assert.ok(html.includes('/recipes/cuisines/american'), 'cuisine slug breadcrumb');
  assert.strictEqual((html.match(/recipe-ingredient-check/g) || []).length, 11, '11 ingredient checkboxes');

  assert.ok(html.includes('Alex Raeburn'), 'uj_member name resolved from team collection');
  assert.ok(html.includes('href="https://ports.example.com/team/alex-raeburn/"'), 'uj_member url resolved');

  assert.ok(html.includes('"data-ad-client": "ca-pub-PORTSTEST"'), 'adsense client from resolved data');
  assert.ok(html.includes('"data-ad-slot": "2222222222"'), 'in-article slot');
  assert.ok(html.includes('"data-ad-slot": "1111111111"'), 'display slot');
  assert.ok(html.includes('"data-ad-slot": "3333333333"'), 'multiplex slot');

  assert.ok(html.includes('/assets/images/recipes/recipe-1764775196/the-best-brown-butter-chocolate-chip-cookies.jpg'),
    'recipe image path');
});

test('real sweet-saucy recipe: JSON-LD Recipe schema is valid and complete', () => {
  const html = pages.get('/recipes/the-best-brown-butter-chocolate-chip-cookies/');
  const match = html.match(/<script id="uj-schema-recipe" type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'schema script present');

  const schema = JSON.parse(match[1]);
  assert.strictEqual(schema['@type'], 'Recipe');
  assert.strictEqual(schema.name, 'The Best Brown Butter Chocolate Chip Cookies');
  assert.strictEqual(schema.prepTime, 'PT240M');
  assert.strictEqual(schema.cookTime, 'PT9M');
  assert.strictEqual(schema.totalTime, 'PT249M');
  assert.strictEqual(schema.author.name, 'Alex Raeburn');
  assert.strictEqual(schema.recipeIngredient.length, 11);
  assert.strictEqual(schema.recipeInstructions.length, 11);
  assert.strictEqual(schema.recipeInstructions[10].position, 11);
  assert.strictEqual(schema.aggregateRating.ratingValue, 4.9);
  assert.strictEqual(schema.publisher['@id'], 'https://ports.example.com#Corporation');
  assert.ok(schema.image[0].startsWith('https://ports.example.com/assets/images/recipes/'), 'absolute image url');
  assert.ok(schema.datePublished.startsWith('2024-06-01'), 'UTC datePublished from page.date');
});

test('real somiibo index: VERBATIM content page through the Liquid pipeline (zero rewrite)', () => {
  const html = pages.get('/');
  assert.ok(html, 'index rendered');

  assert.ok(html.includes('Grow your social media on'), 'hero headline');
  assert.ok(html.includes('<title>PortsCo - Real Layout Ports</title>'), 'frontmatter {{ site.meta.title }}');

  assert.ok(html.includes('PortsCo Dashboard'), 'hero-demo include default title (site.brand.name)');
  assert.ok(html.includes('data-action-1="New follower"'), 'hero-demo config bridge');

  assert.ok(html.includes('/platforms/instagram-bot'), 'platform cards');
  assert.ok((html.match(/class="fa[ "]/g) || []).length > 30, 'dozens of uj_icon renders');
});

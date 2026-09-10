/**
 * A2 real-layout ports against the ports-site fixture — the three REAL files
 * of the migration-cost dimension (UJM classy contact 337L, sweet-saucy
 * recipe 412L + verts/unit sections, somiibo index 456L + its hero-demo
 * include), built through the engine with ONLY the mechanical transforms the
 * B4 codemod would apply (page.resolved.→resolved., canonical/slug/content
 * forms, include leading slash, interpolated-tag-arg fix-forward, and
 * content-entry pages → collection dirs: the recipe doc lives in _recipes/
 * because page frontmatter is meta-only since 2026-07-19).
 * Assertions target REAL data: the UJM default team member via omega_member,
 * verts/unit section placements, and the full JSON-LD Recipe schema.
 *
 * Since B2 the two ported layouts live in the fixture's own `_layouts/` —
 * CONSUMER-LOCAL layouts (the sweet-saucy pattern), resolved as the top
 * layout layer above the packaged themes.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { configureOmega } = require('../src/index.js');

const PKG = path.resolve(__dirname, '..');
const PORTS = path.join(__dirname, 'fixtures', 'ports-site');
const siteData = JSON.parse(fs.readFileSync(path.join(PORTS, 'site-data.json'), 'utf8'));

/**
 * Build the ports fixture and index results by URL.
 * @returns {Promise<Map<string, string>>}
 */
async function buildPorts() {
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(PORTS, path.join(PKG, '.omega', 'test-out-ports'), {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      eleventyConfig.setUseTemplateCache(false);
      return configureOmega(eleventyConfig, {
        consumerDir: PORTS,
        siteData,
        farmDir: path.join(PKG, '.omega', 'layout-farm-ports'),
        assetManifest: { js: { pages: {} }, css: { main: '/assets/css/main-TEST.css', pages: {}, layouts: {} } },
      });
    },
  });

  const results = await elev.toJSON();
  return new Map(results.map((r) => [r.url, r.content]));
}

let pages;
before(async () => {
  pages = await buildPorts();
});

test('real classy contact: layout-frontmatter Liquid, fixed icon args, full sections', () => {
  const html = pages.get('/contact');
  assert.ok(html, '/contact/ rendered');

  // Layout frontmatter carries {{ site.brand.name }} — must render per-site
  assert.ok(html.includes('Have questions about PortsCo? Our support team is here to help you'),
    'layout-frontmatter {{ site.brand.name }} rendered');

  // Hero + form + methods from the layout defaults blob
  assert.ok(html.includes('Get in') && html.includes('touch'), 'hero headline + accent');
  assert.ok(html.includes('id="contact-form"'), 'contact form present');
  assert.ok(html.includes('Email support') && html.includes('Live chat'), 'contact methods rendered');

  // FAQ accordion — 3 items from layout defaults
  assert.ok(html.includes('contactFaqAccordion'), 'FAQ accordion present');
  assert.strictEqual((html.match(/accordion-item/g) || []).length, 3, '3 FAQ items');

  // Fix-forward interpolated icon args (upstream silently emits "text- display-4")
  assert.ok(html.includes('text-warning display-4'), 'stat icon color class interpolated');
  assert.ok(!html.includes('text-{{'), 'no raw Liquid left in classes');
});

test('real sweet-saucy recipe: page-scoped meta, omega_member vs real team doc, verts/unit sections', () => {
  const html = pages.get('/recipes/the-best-brown-butter-chocolate-chip-cookies');
  assert.ok(html, 'recipe page rendered');

  // Layout-frontmatter meta carries {{ page.recipe.title }} — page-scoped rendering
  assert.ok(html.includes('<title>The Best Brown Butter Chocolate Chip Cookies Recipe - PortsCo</title>'),
    'page-scoped layout-frontmatter meta.title rendered');

  assert.ok(html.includes('The Best Brown Butter Chocolate Chip Cookies Recipe</h1>'), 'hero h1');
  assert.ok(html.includes('/recipes/cuisines/american'), 'cuisine slug breadcrumb');
  assert.strictEqual((html.match(/recipe-ingredient-check/g) || []).length, 11, '11 ingredient checkboxes');

  // omega_member against the REAL UJM default team doc
  assert.ok(html.includes('Alex Raeburn'), 'omega_member name resolved from team collection');
  assert.ok(html.includes('href="https://ports.example.com/team/alex-raeburn"'), 'omega_member url resolved');

  // The modern verts/unit section, 3 placements by type (client/slot values
  // live in config — the client verts module reads them at mount, never markup)
  assert.ok(html.includes('data-omega-vert="in-article"'), 'in-article placement');
  assert.ok(html.includes('data-omega-vert="display"'), 'display placement');
  assert.ok(html.includes('data-omega-vert="multiplex"'), 'multiplex placement');

  // Recipe image path built from recipe.id + page slug
  assert.ok(html.includes('/assets/images/recipes/recipe-1764775196/the-best-brown-butter-chocolate-chip-cookies.jpg'),
    'recipe image path');
});

test('real sweet-saucy recipe: JSON-LD Recipe schema is valid and complete', () => {
  const html = pages.get('/recipes/the-best-brown-butter-chocolate-chip-cookies');
  const match = html.match(/<script id="omega-schema-recipe" type="application\/ld\+json">([\s\S]*?)<\/script>/);
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
  assert.ok(schema.image[0].startsWith('https://ports.example.com/assets/images/recipes/'), 'absolute_url image');
  assert.ok(schema.datePublished.startsWith('2024-06-01'), 'date_to_xmlschema on page.date');
});

test('real somiibo index: verbatim content page with consumer include', () => {
  const html = pages.get('/');
  assert.ok(html, 'index rendered');

  assert.ok(html.includes('Grow your social media on'), 'hero headline');
  assert.ok(html.includes('<title>PortsCo - Real Layout Ports</title>'), 'frontmatter {{ site.meta.title }}');

  // Consumer _includes: hero-demo.html with include-param defaults
  assert.ok(html.includes('PortsCo Dashboard'), 'hero-demo include default title (site.brand.name)');
  assert.ok(html.includes('data-action-1="New follower"'), 'hero-demo config bridge');

  assert.ok(html.includes('/platforms/instagram-bot'), 'platform cards');
  assert.ok((html.match(/data-omega-fa="/g) || []).length > 30, 'dozens of icons inlined at build');
});

test('team doc renders at its permalink (Jekyll outputs team pages)', () => {
  assert.ok(pages.get('/team/alex-raeburn'), 'team page output exists');
});

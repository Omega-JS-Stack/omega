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
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
// The lane NAMES the environment
// ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)): the engine reads
// that ONE input instead of a loose `options.environment`, and a fixture build
// with no verb above it is a development build, which is what it always was.
const { setEnvironment } = require('@omega.js/config/environment');
const { configureOmega } = require('../src/index.js');

const PKG = path.resolve(__dirname, '..');
const PORTS = path.join(__dirname, 'fixtures', 'ports-site');
const siteData = JSON.parse(fs.readFileSync(path.join(PORTS, 'site-data.json'), 'utf8'));

/**
 * Build the ports fixture and index results by URL.
 * @returns {Promise<Map<string, string>>}
 */
async function buildPorts() {
  setEnvironment('development');
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

module.exports = defineCases({
  type: 'group',
  description: 'ports',
  setup: async () => {
    pages = await buildPorts();
  },
  tests: [
    {
      name: 'real classy contact: layout-frontmatter Liquid, fixed icon args, full sections',
      run: (ctx) => {
        const html = pages.get('/contact');
        ctx.expect(html, '/contact/ rendered').toBeTruthy();

        // Layout frontmatter carries {{ site.brand.name }} — must render per-site
        ctx.expect(html.includes('Have questions about PortsCo? Our support team is here to help you'), 'layout-frontmatter {{ site.brand.name }} rendered').toBeTruthy();

        // Hero + form + methods from the layout defaults blob
        ctx.expect(html.includes('Get in') && html.includes('touch'), 'hero headline + accent').toBeTruthy();
        ctx.expect(html.includes('id="contact-form"'), 'contact form present').toBeTruthy();
        ctx.expect(html.includes('Email support') && html.includes('Live chat'), 'contact methods rendered').toBeTruthy();

        // FAQ accordion — 3 items from layout defaults
        ctx.expect(html.includes('contactFaqAccordion'), 'FAQ accordion present').toBeTruthy();
        ctx.expect((html.match(/accordion-item/g) || []).length, '3 FAQ items').toBe(3);

        // Fix-forward interpolated icon args (upstream silently emits "text- display-4")
        ctx.expect(html.includes('text-warning display-4'), 'stat icon color class interpolated').toBeTruthy();
        ctx.expect(!html.includes('text-{{'), 'no raw Liquid left in classes').toBeTruthy();
      },
    },

    {
      name: 'real sweet-saucy recipe: page-scoped meta, omega_member vs real team doc, verts/unit sections',
      run: (ctx) => {
        const html = pages.get('/recipes/the-best-brown-butter-chocolate-chip-cookies');
        ctx.expect(html, 'recipe page rendered').toBeTruthy();

        // Layout-frontmatter meta carries {{ page.recipe.title }} — page-scoped rendering
        ctx.expect(html.includes('<title>The Best Brown Butter Chocolate Chip Cookies Recipe - PortsCo</title>'), 'page-scoped layout-frontmatter meta.title rendered').toBeTruthy();

        ctx.expect(html.includes('The Best Brown Butter Chocolate Chip Cookies Recipe</h1>'), 'hero h1').toBeTruthy();
        ctx.expect(html.includes('/recipes/cuisines/american'), 'cuisine slug breadcrumb').toBeTruthy();
        ctx.expect((html.match(/recipe-ingredient-check/g) || []).length, '11 ingredient checkboxes').toBe(11);

        // omega_member against the REAL UJM default team doc
        ctx.expect(html.includes('Alex Raeburn'), 'omega_member name resolved from team collection').toBeTruthy();
        ctx.expect(html.includes('href="https://ports.example.com/team/alex-raeburn"'), 'omega_member url resolved').toBeTruthy();

        // The modern verts/unit section, 3 placements by type (client/slot values
        // live in config — the client verts module reads them at mount, never markup)
        ctx.expect(html.includes('data-omega-vert="in-article"'), 'in-article placement').toBeTruthy();
        ctx.expect(html.includes('data-omega-vert="display"'), 'display placement').toBeTruthy();
        ctx.expect(html.includes('data-omega-vert="multiplex"'), 'multiplex placement').toBeTruthy();

        // Recipe image path built from recipe.id + page slug
        ctx.expect(html.includes('/assets/images/recipes/recipe-1764775196/the-best-brown-butter-chocolate-chip-cookies.jpg'), 'recipe image path').toBeTruthy();
      },
    },

    {
      name: 'real sweet-saucy recipe: JSON-LD Recipe schema is valid and complete',
      run: (ctx) => {
        const html = pages.get('/recipes/the-best-brown-butter-chocolate-chip-cookies');
        const match = html.match(/<script id="omega-schema-recipe" type="application\/ld\+json">([\s\S]*?)<\/script>/);
        ctx.expect(match, 'schema script present').toBeTruthy();

        const schema = JSON.parse(match[1]);
        ctx.expect(schema['@type']).toBe('Recipe');
        ctx.expect(schema.name).toBe('The Best Brown Butter Chocolate Chip Cookies');
        ctx.expect(schema.prepTime).toBe('PT240M');
        ctx.expect(schema.cookTime).toBe('PT9M');
        ctx.expect(schema.totalTime).toBe('PT249M');
        ctx.expect(schema.author.name).toBe('Alex Raeburn');
        ctx.expect(schema.recipeIngredient.length).toBe(11);
        ctx.expect(schema.recipeInstructions.length).toBe(11);
        ctx.expect(schema.recipeInstructions[10].position).toBe(11);
        ctx.expect(schema.aggregateRating.ratingValue).toBe(4.9);
        ctx.expect(schema.publisher['@id']).toBe('https://ports.example.com#Corporation');
        ctx.expect(schema.image[0].startsWith('https://ports.example.com/assets/images/recipes/'), 'absolute_url image').toBeTruthy();
        ctx.expect(schema.datePublished.startsWith('2024-06-01'), 'date_to_xmlschema on page.date').toBeTruthy();
      },
    },

    {
      name: 'real somiibo index: verbatim content page with consumer include',
      run: (ctx) => {
        const html = pages.get('/');
        ctx.expect(html, 'index rendered').toBeTruthy();

        ctx.expect(html.includes('Grow your social media on'), 'hero headline').toBeTruthy();
        ctx.expect(html.includes('<title>PortsCo - Real Layout Ports</title>'), 'frontmatter {{ site.meta.title }}').toBeTruthy();

        // Consumer _includes: hero-demo.html with include-param defaults
        ctx.expect(html.includes('PortsCo Dashboard'), 'hero-demo include default title (site.brand.name)').toBeTruthy();
        ctx.expect(html.includes('data-action-1="New follower"'), 'hero-demo config bridge').toBeTruthy();

        ctx.expect(html.includes('/platforms/instagram-bot'), 'platform cards').toBeTruthy();
        ctx.expect((html.match(/data-omega-fa="/g) || []).length > 30, 'dozens of icons inlined at build').toBeTruthy();
      },
    },

    {
      name: 'team doc renders at its permalink (Jekyll outputs team pages)',
      run: (ctx) => {
        ctx.expect(pages.get('/team/alex-raeburn'), 'team page output exists').toBeTruthy();
      },
    },
  ],
});

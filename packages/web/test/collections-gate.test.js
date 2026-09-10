/**
 * The collections half of the render gate (#200 Lane B). A framework default
 * page is registered unconditionally and decides per build whether it ships;
 * `eleventyExcludeFromCollections` is what keeps a SHUT one out of every
 * collection, so nothing downstream (blog listings, sitemap, feeds) can see a
 * page that writes no file.
 *
 * Two things can silently break that, and neither shows up in rendered output:
 *   - a PAGINATED template trusting the computed gate — Eleventy reads the key
 *     off raw frontmatter when it expands pagination, long before any computed
 *     value exists, so the gate is invisible there;
 *   - the gate narrowing a template's OWN answer on the way through.
 *
 * The sweep covers every template the engine registers: the packaged defaults
 * on disk, and the pages synthesized for a brand's own collections (#207),
 * which are paginated by definition.
 *
 * ONE family is exempt, deliberately (#564): a canonical LISTING, whose page 1
 * is the collection's own URL (`/blog`, `/docs`) and belongs in sitemap.xml.
 * Eleventy adds only page 0 of a paginated template to collections, so the
 * exemption exposes exactly that page — never `/blog/page/N`, which the index
 * flag marks noindex anyway — and a SHUT listing still writes no file, which
 * every machine-file walk skips on `unless item.url`. An ALIAS-paginated
 * template (one page per taxonomy term) gets no such exemption: its page 0 is
 * one arbitrary term.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { configureOmega } = require('../src/index.js');

const DEFAULTS = path.join(__dirname, '..', 'defaults');
const BARE = path.join(__dirname, 'fixtures', 'bare-site');
const SITE_DATA = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

// The leading frontmatter block of a template, or null.
function frontmatterOf(source) {
  const match = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

// Every template under a dir, recursively.
function templateFiles(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(md|html|liquid)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

// Enough Eleventy config surface for one configureOmega pass, keeping the
// registered virtual templates — the gate data is the product under test.
function stubConfig() {
  const templates = [];
  const noop = () => {};
  const config = {
    templates,
    addTemplate: (virtual, raw, data) => templates.push({ virtual, raw, data }),
    setLiquidOptions: noop,
    setIncludesDirectory: noop,
    amendLibrary: noop,
    addGlobalData: noop,
    addPreprocessor: noop,
    addFilter: noop,
    addUrlTransform: noop,
    addTransform: noop,
    addCollection: noop,
    addWatchTarget: noop,
    // Eleventy hands a function plugin the config itself (#488's slugifier).
    addPlugin: (plugin, ...args) => plugin(config, ...args),
    on: noop,
    ignores: new Set(),
  };
  return config;
}

// The real packaged defaults over a consumer that claims `/` — so the index
// default's gate is SHUT and every other default's gate is open.
function templates(t, siteData) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gate-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));

  const config = stubConfig();
  configureOmega(config, {
    consumerDir: BARE,
    siteData: siteData || SITE_DATA,
    environment: 'development',
    farmDir: path.join(out, 'farm'),
    assetManifest: { js: { pages: {} }, css: { pages: {}, layouts: {} } },
  });
  return config.templates;
}

function gates(t) {
  return new Map(templates(t).map((entry) => [entry.virtual, entry.data]));
}

const excludeGate = (data) => data.eleventyComputed.eleventyExcludeFromCollections;

// The canonical listings (#564): page 1 of each IS a real URL of the site, so
// it stays in the collections the machine files walk. Every other paginated
// default excludes itself.
const LISTING_DEFAULTS = ['pages/blog.md'];

const EXCLUDES = /^eleventyExcludeFromCollections:\s*true\s*$/m;
const PAGINATES = /^pagination:/m;
const ALIAS = /^\s+alias:/m;

test('every paginated default spells eleventyExcludeFromCollections in its own frontmatter', () => {
  // defaults/ is the WHOLE set of templates the render gate covers (the engine
  // registers default pages and the showcase; themes ship layouts and
  // sections, never page templates).
  const paginated = templateFiles(DEFAULTS)
    .map((file) => ({ rel: path.relative(DEFAULTS, file).split(path.sep).join('/'), frontmatter: frontmatterOf(fs.readFileSync(file, 'utf8')) }))
    .filter((entry) => entry.frontmatter && PAGINATES.test(entry.frontmatter));

  const offenders = paginated.filter((entry) => !LISTING_DEFAULTS.includes(entry.rel) && !EXCLUDES.test(entry.frontmatter));
  assert.deepEqual(offenders.map((entry) => entry.rel), [],
    'Eleventy reads eleventyExcludeFromCollections off RAW frontmatter when it expands pagination, '
    + 'so the render gate\'s computed value never reaches a paginated template — every one of them must '
    + 'carry the literal `eleventyExcludeFromCollections: true`, or its generated pages land in the '
    + 'collections a suppressed page must stay out of');
});

test('#564: the canonical listing is the ONE exemption, and it is not an alias generator', () => {
  const listings = LISTING_DEFAULTS.map((rel) => ({ rel, frontmatter: frontmatterOf(fs.readFileSync(path.join(DEFAULTS, rel), 'utf8')) }));

  for (const entry of listings) {
    assert.ok(PAGINATES.test(entry.frontmatter), `${entry.rel} paginates`);
    assert.ok(!ALIAS.test(entry.frontmatter),
      `${entry.rel} must paginate a LISTING, not one page per term — an alias generator's page 0 is one arbitrary term, `
      + 'and putting that in the sitemap while its siblings stay out is exactly the disagreement #564 reports');
    assert.ok(!EXCLUDES.test(entry.frontmatter),
      `${entry.rel} must NOT exclude itself from collections: its page 1 is the canonical listing URL, and a page `
      + 'cannot be in sitemap.xml if it is not in the walk sitemap.xml reads (#564)');
  }
});

test('every synthesized collection page spells it too', (t) => {
  // The dynamic pages (#207) are built as source strings, so the same
  // invariant is a property of the GENERATOR: a listing or category page that
  // lost the key would paginate its way into the sitemap and the page index.
  const synthesized = templates(t, {
    ...SITE_DATA,
    collections: { docs: { field: 'doc.category' }, recipes: { field: 'recipe.cuisine', size: 3 } },
  }).filter((entry) => entry.virtual.startsWith('omega-dynamic/'));

  assert.deepEqual(synthesized.map((entry) => entry.virtual), [
    'omega-dynamic/docs/index.html',
    'omega-dynamic/docs/categories.html',
    'omega-dynamic/recipes/index.html',
    'omega-dynamic/recipes/categories.html',
  ], 'every declared collection generates its listing and its category pages');

  for (const entry of synthesized) {
    const frontmatter = frontmatterOf(entry.raw);
    assert.ok(PAGINATES.test(frontmatter), `${entry.virtual} paginates`);

    // The listing carries the blog listing's own exemption (#564); the
    // category generator is an alias generator and keeps the key.
    if (entry.virtual.endsWith('/index.html')) {
      assert.ok(!EXCLUDES.test(frontmatter),
        `${entry.virtual} is the collection's canonical listing — excluding it from collections is what kept `
        + '/blog and /docs out of sitemap.xml (#564)');
      continue;
    }

    assert.ok(EXCLUDES.test(frontmatter),
      `${entry.virtual} must carry the literal \`eleventyExcludeFromCollections: true\` — Eleventy reads it off `
      + 'RAW frontmatter when it expands pagination, so a computed value never reaches a paginated template');
  }
});

test('an open gate passes the template\'s own eleventyExcludeFromCollections through verbatim', (t) => {
  const gate = gates(t).get('omega-defaults/about.md');
  assert.ok(gate, 'the about default page is registered');

  assert.equal(excludeGate(gate)({ eleventyExcludeFromCollections: undefined }), undefined,
    'a page that never sets the key must not come out of the gate holding a value');
  assert.deepEqual(excludeGate(gate)({ eleventyExcludeFromCollections: ['posts'] }), ['posts'],
    'Eleventy also takes a list of collections to skip — narrowing the answer to a boolean rewrites it');
});

test('a shut gate keeps the page out of every collection', (t) => {
  // The bare fixture's own pages/index.html claims `/` — the framework index
  // default steps aside.
  const gate = gates(t).get('omega-defaults/index.md');
  assert.ok(gate, 'a suppressed default is still REGISTERED — the gate is a render-time answer');

  assert.equal(excludeGate(gate)({ eleventyExcludeFromCollections: ['posts'] }), true,
    'a page that writes no file belongs in no collection, whatever its frontmatter asked for');
  assert.equal(gate.eleventyComputed.permalink({ eleventyExcludeFromCollections: undefined }), false,
    'and it writes no file');
});

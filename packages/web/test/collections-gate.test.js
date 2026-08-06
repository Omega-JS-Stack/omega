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
  return {
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
    on: noop,
    ignores: new Set(),
  };
}

// The real packaged defaults over a consumer that claims `/` — so the index
// default's gate is SHUT and every other default's gate is open.
function gates(t) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gate-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));

  const config = stubConfig();
  configureOmega(config, {
    consumerDir: BARE,
    siteData: SITE_DATA,
    environment: 'development',
    farmDir: path.join(out, 'farm'),
    assetManifest: { js: { pages: {} }, css: { pages: {}, themePages: {} } },
  });
  return new Map(config.templates.map((entry) => [entry.virtual, entry.data]));
}

const excludeGate = (data) => data.eleventyComputed.eleventyExcludeFromCollections;

test('every paginated default spells eleventyExcludeFromCollections in its own frontmatter', () => {
  // defaults/ is the WHOLE set of templates the render gate covers (the engine
  // registers default pages and the showcase; themes ship layouts and
  // sections, never page templates).
  const offenders = templateFiles(DEFAULTS).filter((file) => {
    const frontmatter = frontmatterOf(fs.readFileSync(file, 'utf8'));
    return frontmatter
      && /^pagination:/m.test(frontmatter)
      && !/^eleventyExcludeFromCollections:\s*true\s*$/m.test(frontmatter);
  });

  assert.deepEqual(offenders.map((file) => path.relative(DEFAULTS, file)), [],
    'Eleventy reads eleventyExcludeFromCollections off RAW frontmatter when it expands pagination, '
    + 'so the render gate\'s computed value never reaches a paginated template — every one of them must '
    + 'carry the literal `eleventyExcludeFromCollections: true`, or its generated pages land in the '
    + 'collections a suppressed page must stay out of');
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

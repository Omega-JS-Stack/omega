/**
 * Theme-contract suite (B2): EVERY packaged theme must build the ENTIRE
 * default page set through buildSite() — a bare consumer (a few collection
 * docs, no pages) gets the full working site. Pins: page count, key URLs,
 * literal /404.html, taxonomy + collection generators, markdown legal
 * layouts, manifest-injected assets, zero unresolved Liquid, and the
 * classy-fallback contract for partial themes (neobrutalism, newsflash).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { buildSite } = require('../src/build.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const SITE = path.join(__dirname, 'fixtures', 'contract-site');
const siteData = JSON.parse(fs.readFileSync(path.join(SITE, 'site-data.json'), 'utf8'));

const THEMES = ['classy', 'neobrutalism', 'newsflash'];
const builds = {};

/**
 * Read a built page's HTML.
 * @param {string} theme
 * @param {string} rel - output-relative path
 * @returns {string}
 */
function page(theme, rel) {
  return fs.readFileSync(path.join(PKG, '.omega', `contract-${theme}`, rel), 'utf8');
}

before(async () => {
  for (const theme of THEMES) {
    builds[theme] = await buildSite({
      consumerDir: SITE,
      siteData: { ...siteData, theme: { id: theme } },
      outDir: path.join(PKG, '.omega', `contract-${theme}`),
      clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
      skipPurge: true, // purge is pinned in assets.test.js; contract pins rendering
    });
  }
});

test('every theme builds the full default page set for a bare consumer', () => {
  for (const theme of THEMES) {
    assert.ok(builds[theme].htmlCount >= 60, `${theme}: ${builds[theme].htmlCount} pages (full default set)`);
  }
  // Identical page sets across themes — fallback fills every gap
  assert.strictEqual(builds.neobrutalism.htmlCount, builds.classy.htmlCount, 'neobrutalism = classy page count');
  assert.strictEqual(builds.newsflash.htmlCount, builds.classy.htmlCount, 'newsflash = classy page count');
});

test('key default pages land at their real URLs', () => {
  for (const rel of [
    '404.html', 'about/index.html', 'pricing/index.html', 'signin/index.html',
    'contact/index.html', 'blog/index.html', 'terms/index.html', 'team/index.html',
    'careers/index.html', 'payment/checkout/index.html', 'admin/dashboard/index.html',
  ]) {
    assert.ok(fs.existsSync(path.join(PKG, '.omega', 'contract-classy', rel)), `classy builds ${rel}`);
  }
});

test('collection docs + generators: team, updates, alternatives, taxonomy', () => {
  assert.ok(page('classy', 'team/ian-wiedenman/index.html').includes('Ian Wiedenman'), 'team member page');
  assert.ok(page('classy', 'updates/v1.0.0/index.html').includes('1.0.0'), 'update page');
  assert.ok(page('classy', 'alternatives/example-competitor/index.html').includes('Example Competitor'), 'alternative page');
  assert.ok(page('classy', 'blog/categories/news/index.html').includes('Hello OMEGA'), 'category generator page lists its post');
  assert.ok(page('classy', 'blog/tags/omega/index.html').includes('OMEGA'), 'tag generator page');
});

test('markdown legal layout renders its default text as HTML (append pattern)', () => {
  const terms = page('classy', 'terms/index.html');
  assert.ok(terms.includes('<h2') || terms.includes('<h1'), 'legal markdown became HTML headings');
  assert.ok(terms.includes('Contract'), 'brand name templated into legal text');
});

test('manifest-injected assets on every theme (hashed main css/js, valid Configuration)', () => {
  for (const theme of THEMES) {
    const html = page(theme, 'pricing/index.html');
    assert.match(html, /href="\/assets\/css\/main-[a-f0-9]{8}\.css"/, `${theme}: hashed main css linked`);
    assert.match(html, /<script type="module" src="\/assets\/js\/main-[A-Z0-9]{8}\.js"><\/script>/, `${theme}: hashed main js linked as an ESM module`);
    assert.ok(html.includes('brand: {"id":"contract","name":"Contract"}'), `${theme}: Configuration brand`);
    assert.ok(html.includes(`data-theme-id="${theme}"`), `${theme}: active theme id in chrome`);
  }
});

test('no unresolved Liquid syntax leaks into any built page', () => {
  for (const theme of THEMES) {
    const outDir = path.join(PKG, '.omega', `contract-${theme}`);
    const leaks = [];
    for (const entry of fs.readdirSync(outDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      const file = path.join(entry.parentPath, entry.name);
      const html = fs.readFileSync(file, 'utf8');
      if (html.includes('{{ ') || html.includes('{% ') || html.includes('Liquid error')) {
        leaks.push(path.relative(outDir, file));
      }
    }
    assert.deepStrictEqual(leaks, [], `${theme}: pages with unresolved Liquid`);
  }
});

test('redirect module: careers renders the redirect chrome', () => {
  const careers = page('classy', 'careers/index.html');
  assert.ok(careers.includes('docs.google.com/forms'), 'redirect target URL present');
});

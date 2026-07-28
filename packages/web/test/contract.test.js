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
  // Identical page sets across themes — fallback fills every gap. The ONE
  // sanctioned delta (cp219): the showcase documents each theme's RESOLVED
  // library, so a theme shipping its own sections gets exactly that many
  // extra entry pages. Derived from the collector, never hardcoded — a new
  // theme-only section moves both sides together.
  const { buildSectionLibrary } = require('../src/sections.js');
  const libSize = (...layers) => buildSectionLibrary({
    baseDirs: layers.map((layer) => path.join(PKG, 'themes', layer)),
  }).entries.length;
  assert.strictEqual(builds.neobrutalism.htmlCount, builds.classy.htmlCount, 'neobrutalism = classy page count (no own sections)');
  assert.strictEqual(
    builds.newsflash.htmlCount - builds.classy.htmlCount,
    libSize('newsflash', 'classy') - libSize('classy'),
    'newsflash delta = its own showcase entries, nothing else',
  );
});

test('key default pages land at their real URLs', () => {
  for (const rel of [
    '404.html', 'about.html', 'pricing.html', 'signin.html',
    'contact.html', 'blog.html', 'terms.html', 'team.html',
    'careers.html', 'payment/checkout.html', 'admin.html', 'dashboard/account.html',
  ]) {
    assert.ok(fs.existsSync(path.join(PKG, '.omega', 'contract-classy', rel)), `classy builds ${rel}`);
  }
});

test('collection docs + generators: team, updates, alternatives, taxonomy', () => {
  assert.ok(page('classy', 'team/ian-wiedenman.html').includes('Ian Wiedenman'), 'team member page');
  assert.ok(page('classy', 'updates/v1.0.0.html').includes('1.0.0'), 'update page');
  assert.ok(page('classy', 'alternatives/example-competitor.html').includes('Example Competitor'), 'alternative page');
  assert.ok(page('classy', 'blog/categories/news.html').includes('Hello OMEGA'), 'category generator page lists its post');
  assert.ok(page('classy', 'blog/tags/omega.html').includes('OMEGA'), 'tag generator page');
});

test('markdown legal layout renders its default text as HTML (append pattern)', () => {
  const terms = page('classy', 'terms.html');
  assert.ok(terms.includes('<h2') || terms.includes('<h1'), 'legal markdown became HTML headings');
  assert.ok(terms.includes('Contract'), 'brand name templated into legal text');
});

// #9: the cookie policy shipped as raw INDENTED html inside a .md blueprint,
// so markdown mangled it (`<p><li>`, literal `**Brand**`) and — because it
// carried no headings — the page JS hid the TOC rail, dropping the document
// into the rail's 15rem grid track. Every legal blueprint is markdown now, and
// the three pages get the SAME document treatment.
test('#9: every legal page gets the same document treatment as terms/privacy', () => {
  for (const theme of THEMES) {
    for (const file of ['terms.html', 'privacy.html', 'cookies.html']) {
      const html = page(theme, file);
      // Comments are not rendered text — terms.md parks a draft clause in one.
      const doc = html.slice(html.indexOf('data-legal-doc'), html.indexOf('classy-legal__doc-foot')).replace(/<!--[\s\S]*?-->/g, '');

      assert.ok(html.includes('<article class="classy-legal__doc classy-prose" data-legal-doc>'), `${theme}/${file}: the document wrapper`);
      assert.ok(doc.includes('<h2>'), `${theme}/${file}: section headings — no headings means the JS hides the rail and the doc falls into its track`);
      assert.ok(!doc.includes('**'), `${theme}/${file}: markdown emphasis resolved, never literal`);
      assert.ok(!/<p>\s*<li>/.test(doc), `${theme}/${file}: no list mangled by markdown's indented-html handling`);
      assert.ok(doc.includes('Contract'), `${theme}/${file}: brand name templated into the legal text`);
    }
  }
});

// #86: consumers cannot fix stock-chrome icon misses, so a Pro-only icon name
// in packaged markup must break the build lane. uj_icon (template-kit media.js)
// tags every unresolved name onto its fallback triangle.
test('#86: no stock page ships a missing-icon marker', () => {
  for (const theme of THEMES) {
    const outDir = path.join(PKG, '.omega', `contract-${theme}`);
    const misses = [];
    for (const entry of fs.readdirSync(outDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      const html = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
      for (const [, slug] of html.matchAll(/data-omega-icon-missing="([^"]*)"/g)) {
        misses.push(`${path.relative(outDir, path.join(entry.parentPath, entry.name))}: ${slug}`);
      }
    }
    assert.deepStrictEqual([...new Set(misses)], [], `${theme}: icon names that resolved to the fallback triangle`);
  }
});

test('manifest-injected assets on every theme (hashed main css/js, valid Configuration)', () => {
  for (const theme of THEMES) {
    const html = page(theme, 'pricing.html');
    assert.match(html, /href="\/assets\/css\/main-[a-f0-9]{8}\.css"/, `${theme}: hashed main css linked`);
    assert.match(html, /<script type="module" src="\/assets\/js\/main-[A-Z0-9]{8}\.js"><\/script>/, `${theme}: hashed main js linked as an ESM module`);
    assert.ok(html.includes('brand: {"id":"contract","name":"Contract"}'), `${theme}: Configuration brand`);
    assert.ok(html.includes(`data-theme-id="${theme}"`), `${theme}: active theme id in chrome`);
  }
});

test('dispersal-era section markers are DEAD: no packaged template carries `### X ###` (C2)', () => {
  const roots = [
    path.join(PKG, 'defaults'),
    path.join(PKG, 'core'),
    path.join(PKG, 'themes'),
  ];
  const offenders = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(html|md)$/.test(entry.name)) continue;
      const file = path.join(entry.parentPath, entry.name);
      if (/^### .+ ###\s*$/m.test(fs.readFileSync(file, 'utf8'))) {
        offenders.push(path.relative(PKG, file));
      }
    }
  }
  assert.deepStrictEqual(offenders, [], 'files still carrying dispersal-era markers');
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
  const careers = page('classy', 'careers.html');
  assert.ok(careers.includes('docs.google.com/forms'), 'redirect target URL present');
});

test('redirect shortlinks: auth + billing defaults emit their targets', () => {
  const cases = [
    ['login.html', '/signin'],
    ['register.html', '/signup'],
    ['join.html', '/signup'],
    ['forgot.html', '/reset?authSignout=true'],
    ['recover.html', '/reset?authSignout=true'],
    ['reset-password.html', '/reset?authSignout=true'],
    ['change-password.html', '/reset?authSignout=true'],
    ['cancel.html', '/dashboard/account#billing'],
    ['refund.html', '/terms'],
  ];
  for (const [file, target] of cases) {
    assert.ok(page('classy', file).includes(target), `${file} → ${target}`);
  }
});

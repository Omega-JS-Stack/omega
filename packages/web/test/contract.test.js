/**
 * Theme-contract suite (B2): EVERY packaged theme must build the ENTIRE
 * default page set through buildSite() — a bare consumer (a few collection
 * docs, no pages) gets the full working site. Pins: page count, key URLs,
 * literal /404.html, taxonomy + collection generators, markdown legal
 * layouts, manifest-injected assets, zero unresolved Liquid, and the
 * base-fallback contract for partial themes (neobrutalism, newsflash).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { buildTheme, themeOutDir, FIXTURE_VERSION } = require('./lib/contract-build.js');

const PKG = path.resolve(__dirname, '..');

const THEMES = ['classy', 'neobrutalism', 'newsflash'];
const builds = {};

/**
 * Read a built page's HTML.
 * @param {string} theme
 * @param {string} rel - output-relative path
 * @returns {string}
 */
function page(theme, rel) {
  return fs.readFileSync(path.join(themeOutDir(theme), rel), 'utf8');
}

// One process per theme (#179): Eleventy's layout cache is a module singleton
// that outlives the instance, so same-process theme builds share the FIRST
// theme's layouts. See test/lib/contract-build.js.
before(async () => {
  await Promise.all(THEMES.map(async (theme) => {
    builds[theme] = await buildTheme(theme);
  }));
});

test('every theme builds the full default page set for a bare consumer', () => {
  for (const theme of THEMES) {
    assert.ok(builds[theme].htmlCount >= 60, `${theme}: ${builds[theme].htmlCount} pages (full default set)`);
  }
  // Identical page sets across themes — fallback fills every gap. The ONE
  // sanctioned delta (cp219): the showcase documents each theme's RESOLVED
  // library, so a theme shipping its own sections gets exactly that many
  // extra entry pages — plus one embedded-frame page per demo variant of
  // them (#463). Derived from the collector, never hardcoded — a new
  // theme-only section (or a new demo variant) moves both sides together.
  const { buildSectionLibrary } = require('../src/sections.js');
  const libSize = (...layers) => {
    const library = buildSectionLibrary({
      baseDirs: layers.map((layer) => path.join(PKG, 'themes', layer)),
    });
    return library.entries.length + library.variants.length;
  };
  assert.strictEqual(builds.neobrutalism.htmlCount, builds.classy.htmlCount, 'neobrutalism = classy page count (no own sections)');
  assert.strictEqual(
    builds.newsflash.htmlCount - builds.classy.htmlCount,
    libSize('newsflash', 'base') - libSize('base'),
    'newsflash delta = its own showcase entries and their frames, nothing else',
  );
});

// #179: every assertion here used to be theme-agnostic, so the suite stayed
// green while the neobrutalism and newsflash outputs rendered CLASSY pages:
// Eleventy's module-singleton layout cache served the first build's layouts to
// the other two. Each homepage carries its own layout's signature markup, so a
// returning leak fails here instead of shipping wrong fixtures.
test('#179: every theme renders its OWN homepage layout (no cross-build layout-cache leak)', () => {
  const markers = {
    classy: 'omega-hero', // no own index layout: the base marketing/hero section
    neobrutalism: 'neo-hero', // its own index layout
    newsflash: 'newsflash-hero', // its own index layout
  };
  for (const theme of THEMES) {
    // Markup only: the inlined critical CSS (#750) carries the shared base
    // section rules (`.omega-hero{...}`) into every theme's head, and a
    // selector in a style block is not a rendered layout
    const html = page(theme, 'index.html').replace(/<style[\s\S]*?<\/style>/g, '');
    assert.ok(html.includes(markers[theme]), `${theme}: homepage missing its own markup (${markers[theme]})`);
    for (const other of THEMES.filter((id) => id !== theme)) {
      assert.ok(!html.includes(markers[other]), `${theme}: homepage rendered ${other} markup (${markers[other]})`);
    }
  }
});

test('key default pages land at their real URLs', () => {
  for (const rel of [
    '404.html', 'about.html', 'pricing.html', 'signin.html',
    'contact.html', 'blog.html', 'terms.html', 'team.html',
    'careers.html', 'payment/checkout.html', 'admin.html', 'dashboard/account.html',
  ]) {
    assert.ok(fs.existsSync(path.join(themeOutDir('classy'), rel)), `classy builds ${rel}`);
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
      // Anchored on the MARKUP: the page's own sheet is inlined in the head
      // (#767), so the bare class token first appears in a selector up there.
      const region = html.slice(html.indexOf('data-legal-doc'), html.indexOf('class="omega-legal__doc-foot'));
      // #92: a commented-out clause is still SHIPPED bytes — a draft parked in
      // an HTML comment reaches every consumer's legal page verbatim, raw
      // markdown and all. Comments in a legal document carry no draft copy.
      const drafts = [...region.matchAll(/<!--[\s\S]*?-->/g)]
        .filter(([comment]) => comment.includes('**'))
        .map(([comment]) => comment.slice(0, 80));
      assert.deepStrictEqual(drafts, [], `${theme}/${file}: HTML comments shipping draft markdown`);
      // Comments are not rendered text — the rendered-copy checks skip them.
      const doc = region.replace(/<!--[\s\S]*?-->/g, '');

      assert.ok(html.includes('<article class="omega-legal__doc omega-prose" data-legal-doc>'), `${theme}/${file}: the document wrapper`);
      assert.ok(doc.includes('<h2>'), `${theme}/${file}: section headings — no headings means the JS hides the rail and the doc falls into its track`);
      assert.ok(!doc.includes('**'), `${theme}/${file}: markdown emphasis resolved, never literal`);
      assert.ok(!/<p>\s*<li>/.test(doc), `${theme}/${file}: no list mangled by markdown's indented-html handling`);
      assert.ok(doc.includes('Contract'), `${theme}/${file}: brand name templated into the legal text`);
    }
  }
});

// #86: consumers cannot fix stock-chrome icon misses, so a Pro-only icon name
// in packaged markup must break the build lane. The build's inlining pass
// (#619) marks every unresolved name on the element it left empty.
test('#86: no stock page ships a missing-icon marker', () => {
  for (const theme of THEMES) {
    const outDir = themeOutDir(theme);
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

// #380: the ONE place web hands the client its error-reporting config. Evaluated,
// not string-matched, so a Liquid slip that renders unparseable JS fails HERE
// rather than as a blank page in a browser.
test('#380: omega.json5 `monitoring` reaches the client as its sentry contract', () => {
  for (const theme of THEMES) {
    const html = page(theme, 'pricing.html');
    const source = html.match(/var Configuration = (\{[\s\S]*?\});\s*<\/script>/);
    assert.ok(source, `${theme}: the Configuration block is present`);

    const config = new Function(`return ${source[1]}`)();
    assert.strictEqual(config.sentry.enabled, true, `${theme}: a configured DSN is the enable signal`);
    assert.strictEqual(config.sentry.config.dsn, 'https://key@o1.ingest.sentry.io/1', `${theme}: the DSN rides`);
    assert.strictEqual(config.sentry.config.org, 'contract-org', `${theme}: the whole sentry PROVIDER block rides (#425), never the role level around it`);
    assert.strictEqual(config.sentry.config.providers, undefined, `${theme}: and the providers wrapper never does`);
    // The release tag's version half: the WEBSITE APP's own package version, so
    // every host tags `brand.id@version` instead of falling back to buildTime.
    assert.strictEqual(config.version, FIXTURE_VERSION, `${theme}: the target's own version rides the Configuration block`);
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
    const outDir = themeOutDir(theme);
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

test('#16: no LEGACY click-trigger class survives in built output (html/css/js)', () => {
  // The three names the unified `omega-*` trigger registry retired. No aliases
  // were kept, so a single surviving spelling in dist means dead markup: the
  // class no longer has a handler behind it.
  const legacy = ['auth-signout-btn', 'auth-signin-btn', 'uj-password-toggle'];
  for (const theme of THEMES) {
    const outDir = themeOutDir(theme);
    const offenders = [];
    for (const entry of fs.readdirSync(outDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(html|css|js)$/.test(entry.name)) continue;
      const file = path.join(entry.parentPath, entry.name);
      const contents = fs.readFileSync(file, 'utf8');
      for (const name of legacy) {
        if (contents.includes(name)) {
          offenders.push(`${path.relative(outDir, file)} → ${name}`);
        }
      }
    }
    assert.deepStrictEqual(offenders, [], `${theme}: built files still carrying a legacy trigger class`);
  }

  // The replacements ARE in the output — otherwise the assertion above passes
  // for the wrong reason (a build that emitted no auth markup at all).
  assert.ok(page('classy', 'signin.html').includes('omega-password-toggle'), 'signin carries the password-eye trigger');
  assert.ok(page('classy', 'dashboard/account.html').includes('omega-signout'), 'the account menu carries the sign-out trigger');
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

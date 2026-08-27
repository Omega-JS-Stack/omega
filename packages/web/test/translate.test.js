/**
 * translateSite integration — a handcrafted dist/ (no Eleventy needed) run
 * through the real pipeline with a fake provider: /{lang}/ copies, localized
 * chrome (lang/dir/canonical/og), link rewriting, exclusions (system + config
 * + socials + opt-out attr), hreflang stitching into originals, the committed
 * per-string cache (hits, human overrides), the only-filter, and per-page
 * failure fallback.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { translateSite } = require('../src/translate/index.js');
const { hashKey, CONTROL } = require('@omega.js/devkit/translate');

const PAGE = (title, body, prefix = '') => `<!doctype html><html lang="en" dir="ltr"${prefix ? ` data-omega-path-prefix="${prefix}"` : ''}><head>
<title>${title}</title>
<meta name="description" content="A fine page"/>
<meta property="og:url" content="https://mini.co/"/>
<meta property="og:locale" content="en"/>
<link rel="canonical" href="https://mini.co/"/>
<link rel="alternate" href="https://mini.co/" hreflang="x-default"/>
<link rel="alternate" href="https://mini.co/" hreflang="en"/>
</head><body>${body}</body></html>`;

// The built sitemap as defaults/pages/sitemap.html emits it (source language
// only, entries in loc byte order, the home loc bare)
const SITEMAP_ENTRY = (loc, priority) => `  <url>
    <loc>${loc}</loc>
    <lastmod>2026-07-29T00:00:00.000Z</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;

const SITEMAP = (base = 'https://mini.co') => `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  >
${[
    SITEMAP_ENTRY(base, '1.0'),
    SITEMAP_ENTRY(`${base}/about`, '0.5'),
    SITEMAP_ENTRY(`${base}/signin`, '0.5'),
  ].join('\n')}
</urlset>
`;

/**
 * Stage a consumer root with a built dist. `prefix` stages what a MOUNTED
 * build (#355) emits: the base path stamped on <html>, every internal href
 * already carrying it, and the sitemap written from a `brand.url` that carries
 * it too (absolute URLs are built from brand.url — README: nothing prefixes
 * them twice). dist itself is the mount root, so file paths never carry it.
 */
function stage(prefix = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-wtr-'));
  const dist = path.join(root, 'dist');

  const write = (rel, html) => {
    const file = path.join(dist, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
  };

  write('index.html', PAGE('Welcome home', `
    <p>Grow faster with MiniCo</p>
    <a href="${prefix}/about">About us</a>
    <a href="${prefix}/signin">Sign in</a>
    <a href="https://external.example/x">External</a>
    <span data-omega-no-translate>Do Not Touch</span>
    <input type="submit" value="Send it"/>
    <input type="hidden" value="csrf-token-123"/>`, prefix));
  write('about/index.html', PAGE('About - MiniCo', '<p>The consumer about page</p>', prefix));
  write('signin/index.html', PAGE('Sign in', '<p>Email address</p>', prefix));
  write('admin/panel/index.html', PAGE('Admin', '<p>Secret admin copy</p>', prefix));
  write('skipme/index.html', PAGE('Skipped', '<p>User-excluded page</p>', prefix));
  write('twitter.html', PAGE('Social redirect', '<p>Social</p>', prefix));
  write('sitemap.xml', SITEMAP(`https://mini.co${prefix}`));

  return { root, dist };
}

const CONFIG = {
  brand: { name: 'MiniCo', url: 'https://mini.co' },
  socials: { twitter: 'minico' },
  translation: { languages: ['es', 'ar'], exclude: ['skipme'] },
};

// The same brand served as a project site under /workkit: brand.url carries
// the mount point, exactly as the base-path contract describes it.
const MOUNTED_CONFIG = { ...CONFIG, brand: { ...CONFIG.brand, url: 'https://mini.co/workkit' } };

/** Fake provider: suffixes each string with ·<lang>, tracks calls per lang. */
function fakeSend(calls) {
  return async ({ user }) => {
    const lang = user.match(/^Target language: (\S+)/)[1];
    calls.push(lang);
    const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
    return { text: JSON.stringify(payload.map((s) => (s === CONTROL ? s : `${s.trim()}·${lang}`))), usage: { input: 1, output: 1 } };
  };
}

test('translateSite: copies, chrome, links, exclusions, alternates, cache', async () => {
  const { root, dist } = stage();
  const calls = [];

  const stats = await translateSite({ root, outDir: dist, config: CONFIG, send: fakeSend(calls) });

  // Copies exist for translatable pages only. The language HOME lands as
  // <lang>.html (a FILE, matching the extensionless canonical /es) — an
  // es/index.html would force Pages' directory redirect (/es → /es/) into
  // a 301 loop with the zone's strip-trailing-slash rule.
  assert.ok(fs.existsSync(path.join(dist, 'es.html')));
  assert.ok(!fs.existsSync(path.join(dist, 'es', 'index.html')), 'language home is a file, not a directory index');
  assert.ok(fs.existsSync(path.join(dist, 'es', 'about', 'index.html')));
  assert.ok(fs.existsSync(path.join(dist, 'ar.html')));
  assert.ok(!fs.existsSync(path.join(dist, 'es', 'signin')), 'framework default page excluded');
  assert.ok(!fs.existsSync(path.join(dist, 'es', 'admin')), 'system folder excluded');
  assert.ok(!fs.existsSync(path.join(dist, 'es', 'skipme')), 'config exclude honored');
  assert.ok(!fs.existsSync(path.join(dist, 'es', 'twitter.html')), 'socials redirect excluded');
  assert.strictEqual(stats.pages, 2);

  const es = fs.readFileSync(path.join(dist, 'es.html'), 'utf8');

  // Text + title + meta translated; opt-out and hidden input untouched
  assert.ok(es.includes('Welcome home·es'), 'title translated');
  assert.ok(es.includes('Grow faster with MiniCo·es'), 'body text translated');
  assert.ok(es.includes('A fine page·es'), 'meta description translated');
  assert.ok(es.includes('Send it·es'), 'submit value translated');
  assert.ok(es.includes('Do Not Touch'), 'data-omega-no-translate kept');
  assert.ok(!es.includes('Do Not Touch·es'), 'opt-out really skipped');
  assert.ok(es.includes('csrf-token-123'), 'hidden input value untouched');
  assert.ok(!es.includes('csrf-token-123·es'), 'hidden input value never translated');

  // Localized chrome
  assert.ok(es.includes('lang="es"'));
  assert.ok(es.includes('dir="ltr"'));
  assert.ok(es.includes('<link rel="canonical" href="https://mini.co/es"'));
  assert.ok(es.includes('content="https://mini.co/es"'), 'og:url localized');
  assert.ok(es.includes('property="og:locale" content="es_ES"'), 'og:locale in Open Graph language_TERRITORY form');
  assert.ok(es.includes('og:locale:alternate" content="en_US"'));
  assert.ok(es.includes('og:locale:alternate" content="ar_AR"'));
  assert.ok(!es.includes('og:locale:alternate" content="es"'), 'no bare-code locale alternates');

  // Links: internal rewritten, excluded + external untouched
  assert.ok(es.includes('href="/es/about"'));
  assert.ok(es.includes('href="/signin"'), 'excluded route link not rewritten');
  assert.ok(es.includes('https://external.example/x'));

  // RTL
  const ar = fs.readFileSync(path.join(dist, 'ar.html'), 'utf8');
  assert.ok(ar.includes('lang="ar"') && ar.includes('dir="rtl"'));

  // Originals gained hreflang alternates for exactly the produced languages
  const original = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.ok(original.includes('hreflang="es"'));
  assert.ok(original.includes('hreflang="ar"'));
  assert.ok(original.includes('https://mini.co/es'), 'alternate href points at the copy');

  // Committed cache exists and is a hash → string map
  const cacheFile = path.join(root, 'translations', 'es', 'pages', 'home.json');
  assert.ok(fs.existsSync(cacheFile));
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.strictEqual(cache[hashKey('Welcome home')], 'Welcome home·es');

  // Second run: fully cached — the provider must never be called
  const rerun = await translateSite({
    root, outDir: dist, config: CONFIG,
    send: async () => { throw new Error('provider must not be called on a warm cache'); },
  });
  assert.strictEqual(rerun.newStrings, 0);
  assert.ok(rerun.cachedStrings > 0);
  assert.deepStrictEqual(rerun.failures, []);

  // Human override: hand-edit a cached value → it wins on rebuild
  cache[hashKey('Welcome home')] = 'Bienvenido a casa';
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  await translateSite({ root, outDir: dist, config: CONFIG, send: async () => { throw new Error('no calls'); } });
  const esAgain = fs.readFileSync(path.join(dist, 'es.html'), 'utf8');
  assert.ok(esAgain.includes('Bienvenido a casa'), 'hand-edited cache value sticks');

  fs.rmSync(root, { recursive: true, force: true });
});

test('#605: the framework skips its own default pages with no config exclude at all', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-wtr-'));
  const dist = path.join(root, 'dist');
  const write = (rel, html) => {
    fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
    fs.writeFileSync(path.join(dist, rel), html);
  };

  // The framework's own plumbing, as the build emits it…
  for (const route of ['signin', 'app', 'account', 'dashboard/account', 'payment/checkout', 'portal/email-preferences']) {
    write(`${route}/index.html`, PAGE(route, `<p>Framework ${route}</p>`));
  }
  // …and a page the BRAND wrote.
  write('guides/getting-started/index.html', PAGE('Getting started', '<p>Brand-authored guide</p>'));

  const stats = await translateSite({
    root,
    outDir: dist,
    // No `exclude` key whatsoever — a brand should not have to name any of this
    config: { brand: { name: 'MiniCo', url: 'https://mini.co' }, translation: { languages: ['es'] } },
    send: fakeSend([]),
  });

  for (const route of ['signin', 'app', 'account', 'dashboard/account', 'payment/checkout', 'portal/email-preferences']) {
    assert.ok(!fs.existsSync(path.join(dist, 'es', route)), `/${route} is a framework default page, never translated`);
  }
  assert.ok(fs.existsSync(path.join(dist, 'es', 'guides', 'getting-started', 'index.html')), 'the brand page still translates');
  assert.strictEqual(stats.pages, 1, 'exactly one page was translatable');

  fs.rmSync(root, { recursive: true, force: true });
});

test('translateSite: only-filter limits the run to one page', async () => {
  const { root, dist } = stage();
  const calls = [];

  const stats = await translateSite({ root, outDir: dist, config: CONFIG, send: fakeSend(calls), only: 'about' });

  assert.strictEqual(stats.pages, 1);
  assert.ok(fs.existsSync(path.join(dist, 'es', 'about', 'index.html')));
  assert.ok(!fs.existsSync(path.join(dist, 'es.html')), 'home not translated under only-filter');

  fs.rmSync(root, { recursive: true, force: true });
});

test('translateSite: provider failure skips the page-language pair whole and warns loudly', async () => {
  const { root, dist } = stage();
  const warnings = [];

  const stats = await translateSite({
    root, outDir: dist, config: CONFIG,
    logger: { log: () => {}, warn: (m) => warnings.push(m), error: () => {} },
    send: async ({ user }) => {
      const lang = user.match(/^Target language: (\S+)/)[1];
      if (lang === 'ar') {
        throw new Error('boom');
      }
      const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
      return { text: JSON.stringify(payload.map((s) => (s === CONTROL ? s : `${s.trim()}·es`))), usage: {} };
    },
  });

  assert.ok(stats.failures.length >= 1);
  assert.ok(stats.failures.every((f) => f.startsWith('ar ')), 'only ar failed');

  // No mixed-language copy: the ar pair is skipped whole, like a cold cache
  assert.ok(!fs.existsSync(path.join(dist, 'ar.html')), 'no half-translated language home');
  assert.ok(!fs.existsSync(path.join(dist, 'ar')), 'no half-translated ar copies at all');

  // The failure is loud, naming the page and the language
  const loud = warnings.filter((m) => m.includes('[ar]') && m.includes('boom') && /skipped/i.test(m));
  assert.strictEqual(loud.length, 2, 'both translatable pages warn by page + language');
  assert.strictEqual(stats.failures.length, 2);

  // es still ships, and it never advertises the language that failed
  const es = fs.readFileSync(path.join(dist, 'es.html'), 'utf8');
  assert.ok(es.includes('Grow faster with MiniCo·es'));
  assert.ok(es.includes('hreflang="es"'));
  assert.ok(!es.includes('hreflang="ar"'), 'a failed language is never advertised');

  const original = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.ok(!original.includes('hreflang="ar"'), 'the original stays honest too');

  fs.rmSync(root, { recursive: true, force: true });
});

test('translateSite: a copy advertises only the languages actually produced', async () => {
  const { root, dist } = stage();
  const refuse = async () => { throw new Error('cachedOnly must never call the provider'); };

  // Warm es for /about only, then run cachedOnly with ar configured but cold
  await translateSite({ root, outDir: dist, config: { ...CONFIG, translation: { languages: ['es'] } }, send: fakeSend([]), only: 'about' });
  const stats = await translateSite({ root, outDir: dist, config: CONFIG, cachedOnly: true, send: refuse });

  assert.strictEqual(stats.pages, 1);
  assert.ok(stats.skippedCold.includes('ar /about'), 'ar is cold for about');

  const copy = fs.readFileSync(path.join(dist, 'es', 'about', 'index.html'), 'utf8');
  assert.ok(copy.includes('hreflang="es"'), 'the copy advertises itself');
  assert.ok(!copy.includes('hreflang="ar"'), 'the copy never advertises a language that was not produced');
  assert.ok(!copy.includes('og:locale:alternate" content="ar_AR"'), 'no og:locale alternate for a skipped language');

  fs.rmSync(root, { recursive: true, force: true });
});

test('translateSite: disabled config skips cleanly', async () => {
  const { root, dist } = stage();

  const stats = await translateSite({ root, outDir: dist, config: { brand: { name: 'X' } }, send: async () => {} });
  assert.strictEqual(stats.skipped, true);

  fs.rmSync(root, { recursive: true, force: true });
});

test('translateSite: cachedOnly never calls the provider and skips cold pages whole (friction #24)', async () => {
  const { root, dist } = stage();
  const refuse = async () => { throw new Error('cachedOnly must never call the provider'); };

  // Everything cold → everything skipped, zero copies, zero provider calls
  const cold = await translateSite({ root, outDir: dist, config: CONFIG, cachedOnly: true, send: refuse });
  assert.strictEqual(cold.pages, 0);
  assert.strictEqual(cold.newStrings, 0);
  assert.ok(cold.skippedCold.includes('es /about'), 'about is reported cold for es');
  assert.ok(cold.skippedCold.includes('ar /'), 'home is reported cold for ar');
  assert.ok(!fs.existsSync(path.join(dist, 'es')), 'no copies produced from a cold cache');

  // Warm ONE page (the explicit `omega translate` path), wipe its copies…
  const calls = [];
  await translateSite({ root, outDir: dist, config: CONFIG, send: fakeSend(calls), only: 'about' });
  assert.ok(calls.length > 0);
  fs.rmSync(path.join(dist, 'es'), { recursive: true, force: true });
  fs.rmSync(path.join(dist, 'ar'), { recursive: true, force: true });

  // …then cachedOnly produces the warm page and still skips the cold one
  const warm = await translateSite({ root, outDir: dist, config: CONFIG, cachedOnly: true, send: refuse });
  assert.strictEqual(warm.pages, 1, 'only the warmed page ships');
  assert.ok(fs.existsSync(path.join(dist, 'es', 'about', 'index.html')));
  assert.ok(!fs.existsSync(path.join(dist, 'es', 'index.html')), 'cold home has no copy');
  assert.ok(warm.skippedCold.includes('es /'), 'cold home still reported');

  fs.rmSync(root, { recursive: true, force: true });
});

test('translateSite: the sitemap gains every produced language URL with xhtml:link alternates', async () => {
  const { root, dist } = stage();
  const sitemapFile = path.join(dist, 'sitemap.xml');

  await translateSite({ root, outDir: dist, config: CONFIG, send: fakeSend([]) });

  const xml = fs.readFileSync(sitemapFile, 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  // Every produced copy is listed, and only produced ones
  assert.ok(locs.includes('https://mini.co/es'), 'es language home listed');
  assert.ok(locs.includes('https://mini.co/ar'), 'ar language home listed');
  assert.ok(locs.includes('https://mini.co/es/about'), 'es about listed');
  assert.ok(locs.includes('https://mini.co/ar/about'), 'ar about listed');
  assert.ok(!locs.some((loc) => loc.includes('/signin') && loc.includes('/es/')), 'excluded route gets no copy entry');
  assert.deepStrictEqual(locs, [...locs].sort(), 'entries stay in loc byte order (cp227)');

  // Every entry of a translated set carries the full alternate set, x-default
  // at the source language — sitemap and page-level hreflang tell one story
  const entry = (loc) => xml.match(new RegExp(`<url>\\s*<loc>${loc.replace(/\//g, '\\/')}</loc>[\\s\\S]*?</url>`))[0];
  for (const loc of ['https://mini.co', 'https://mini.co/es', 'https://mini.co/ar']) {
    const block = entry(loc);
    assert.match(block, /<xhtml:link rel="alternate" hreflang="x-default" href="https:\/\/mini\.co"\/>/, `${loc}: x-default`);
    assert.match(block, /<xhtml:link rel="alternate" hreflang="en" href="https:\/\/mini\.co"\/>/, `${loc}: en`);
    assert.match(block, /<xhtml:link rel="alternate" hreflang="es" href="https:\/\/mini\.co\/es"\/>/, `${loc}: es`);
    assert.match(block, /<xhtml:link rel="alternate" hreflang="ar" href="https:\/\/mini\.co\/ar"\/>/, `${loc}: ar`);
  }
  assert.match(entry('https://mini.co/es/about'), /hreflang="ar" href="https:\/\/mini\.co\/ar\/about"\/>/, 'about copy names its sibling');

  // An untranslated page keeps a plain entry
  assert.ok(!entry('https://mini.co/signin').includes('xhtml:link'), 'untranslated page gets no alternates');

  // Copies inherit the source entry's metadata
  assert.match(entry('https://mini.co/es'), /<priority>1\.0<\/priority>/, 'language home inherits the home priority');

  // Idempotent: a second pass neither duplicates entries nor alternates
  await translateSite({ root, outDir: dist, config: CONFIG, send: async () => { throw new Error('warm cache'); } });
  const second = fs.readFileSync(sitemapFile, 'utf8');
  assert.strictEqual([...second.matchAll(/<loc>https:\/\/mini\.co\/es<\/loc>/g)].length, 1, 'no duplicate copy entry');
  assert.strictEqual([...second.matchAll(/hreflang="es" href="https:\/\/mini\.co\/es"/g)].length, 3, 'no duplicate alternates');

  fs.rmSync(root, { recursive: true, force: true });
});

test('translateSite: an unproduced language appears nowhere in the sitemap', async () => {
  const { root, dist } = stage();
  const sitemapFile = path.join(dist, 'sitemap.xml');

  // ar fails at the provider; es ships
  await translateSite({
    root, outDir: dist, config: CONFIG,
    send: async ({ user }) => {
      const lang = user.match(/^Target language: (\S+)/)[1];
      if (lang === 'ar') {
        throw new Error('boom');
      }
      const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
      return { text: JSON.stringify(payload.map((s) => (s === CONTROL ? s : `${s.trim()}·es`))), usage: {} };
    },
  });

  const xml = fs.readFileSync(sitemapFile, 'utf8');
  assert.ok(xml.includes('<loc>https://mini.co/es</loc>'), 'the produced language is listed');
  assert.ok(!xml.includes('/ar'), 'a failed language is never listed or advertised');
  assert.ok(!xml.includes('hreflang="ar"'), 'no alternate for a language that was never written');

  // A stale copy entry from an earlier run is dropped when the language stops
  // being produced (the sitemap owns no lie either)
  await translateSite({
    root, outDir: dist, config: { ...CONFIG, translation: { languages: ['ar'] } },
    cachedOnly: true, send: async () => { throw new Error('no calls'); },
  });
  const after = fs.readFileSync(sitemapFile, 'utf8');
  assert.ok(!after.includes('/es'), 'entries for a no-longer-produced language are removed');

  fs.rmSync(root, { recursive: true, force: true });
});

test('translateSite: a MOUNTED site composes prefix-then-lang in hrefs, alternates and the sitemap (#359)', async () => {
  const { root, dist } = stage('/workkit');

  await translateSite({ root, outDir: dist, config: MOUNTED_CONFIG, send: fakeSend([]) });

  // 1. Page hrefs: the lang segment goes AFTER the base path, and an excluded
  //    route is still recognized through the prefix
  const es = fs.readFileSync(path.join(dist, 'es.html'), 'utf8');
  assert.ok(es.includes('href="/workkit/es/about"'), 'a mounted link keeps its prefix and gains the lang after it');
  assert.ok(es.includes('href="/workkit/signin"'), 'the excluded route is recognized under the prefix, link untouched');
  assert.ok(!es.includes('/es/workkit'), 'the lang segment never lands at the domain root');
  assert.ok(es.includes('href="https://external.example/x"'), 'external links stay external');

  // 2. Localized chrome + hreflang alternates, on the copy and stitched back
  //    into the original
  assert.ok(es.includes('<link rel="canonical" href="https://mini.co/workkit/es"'), 'canonical mounted');
  assert.ok(es.includes('content="https://mini.co/workkit/es"'), 'og:url mounted');
  assert.ok(es.includes('href="https://mini.co/workkit/ar" hreflang="ar"'), 'the copy names its sibling under the base path');

  const original = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.ok(original.includes('href="https://mini.co/workkit/es" hreflang="es"'), 'the original advertises the mounted copy');
  assert.ok(!original.includes('https://mini.co/es'), 'no alternate points at the domain root');
  assert.ok(!/workkit\/workkit/.test(`${es}${original}`), 'an absolute URL is never prefixed twice — it comes from brand.url');

  // 3. The sitemap tells the same story, and re-running does not duplicate it
  //    (a mounted copy entry is recognized as one on the next pass)
  const sitemapFile = path.join(dist, 'sitemap.xml');
  const xml = fs.readFileSync(sitemapFile, 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.includes('https://mini.co/workkit/es/about'), 'the copy is listed under the base path');
  assert.ok(locs.includes('https://mini.co/workkit/ar'), 'the language home too');
  assert.ok(!locs.some((loc) => loc.includes('/es/workkit')), 'never the wrong way round');
  assert.match(xml, /hreflang="es" href="https:\/\/mini\.co\/workkit\/es"\/>/, 'sitemap alternates mounted');
  assert.ok(!xml.includes('workkit/workkit'), 'sitemap URLs are never prefixed twice either');

  await translateSite({ root, outDir: dist, config: MOUNTED_CONFIG, send: async () => { throw new Error('warm cache'); } });
  const second = fs.readFileSync(sitemapFile, 'utf8');
  assert.strictEqual([...second.matchAll(/<loc>https:\/\/mini\.co\/workkit\/es<\/loc>/g)].length, 1, 'no duplicate copy entry on a second pass');

  fs.rmSync(root, { recursive: true, force: true });
});

test('translateSite: an UNMOUNTED site composes exactly as it always has (#359 regression pin)', async () => {
  const { root, dist } = stage();

  await translateSite({ root, outDir: dist, config: CONFIG, send: fakeSend([]) });

  const es = fs.readFileSync(path.join(dist, 'es.html'), 'utf8');
  assert.ok(es.includes('href="/es/about"'), 'href: the lang segment sits at the site root');
  assert.ok(es.includes('href="/signin"'), 'excluded route link untouched');
  assert.ok(es.includes('<link rel="canonical" href="https://mini.co/es"'), 'canonical unchanged');
  assert.ok(es.includes('href="https://mini.co/ar" hreflang="ar"'), 'alternate unchanged');

  const xml = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
  assert.ok(xml.includes('<loc>https://mini.co/es/about</loc>'), 'sitemap entry unchanged');
  assert.match(xml, /hreflang="es" href="https:\/\/mini\.co\/es"\/>/, 'sitemap alternate unchanged');

  fs.rmSync(root, { recursive: true, force: true });
});

test('updateSitemap: a loc with query-string ampersands stays valid XML, and an unproduced prefixed entry is dropped with a warning', () => {
  const { updateSitemap } = require('../src/translate/sitemap.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-sitemap-'));
  const sitemapFile = path.join(root, 'sitemap.xml');
  fs.writeFileSync(sitemapFile, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    SITEMAP_ENTRY('https://mini.co/search?a=1&amp;b=2', '0.5'),
    SITEMAP_ENTRY('https://mini.co/it/legacy', '0.5'),
    '</urlset>',
    '',
  ].join('\n'));

  const warns = [];
  const count = updateSitemap({
    outDir: root,
    baseUrl: 'https://mini.co',
    defaultLang: 'en',
    produced: new Map([['search?a=1&b=2', ['es']]]),
    logger: { warn: (message) => warns.push(message) },
  });

  const xml = fs.readFileSync(sitemapFile, 'utf8');
  assert.equal(count, 1);
  assert.ok(xml.includes('<loc>https://mini.co/es/search?a=1&amp;b=2</loc>'), 'the cloned loc re-escapes the ampersand');
  assert.ok(xml.includes('href="https://mini.co/es/search?a=1&amp;b=2"'), 'alternate hrefs re-escape too');
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(xml), 'no bare ampersand survives anywhere');
  assert.equal(warns.length, 1, 'the dropped, never-re-emitted /it/legacy entry warns');
  assert.ok(warns[0].includes('https://mini.co/it/legacy'), 'the warning names the lost loc');

  fs.rmSync(root, { recursive: true, force: true });
});

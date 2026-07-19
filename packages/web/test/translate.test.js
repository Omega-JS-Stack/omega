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

const PAGE = (title, body) => `<!doctype html><html lang="en" dir="ltr"><head>
<title>${title}</title>
<meta name="description" content="A fine page"/>
<meta property="og:url" content="https://mini.co/"/>
<meta property="og:locale" content="en"/>
<link rel="canonical" href="https://mini.co/"/>
<link rel="alternate" href="https://mini.co/" hreflang="x-default"/>
<link rel="alternate" href="https://mini.co/" hreflang="en"/>
</head><body>${body}</body></html>`;

/** Stage a consumer root with a built dist. */
function stage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-wtr-'));
  const dist = path.join(root, 'dist');

  const write = (rel, html) => {
    const file = path.join(dist, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
  };

  write('index.html', PAGE('Welcome home', `
    <p>Grow faster with MiniCo</p>
    <a href="/about">About us</a>
    <a href="/checkout">Buy now</a>
    <a href="https://external.example/x">External</a>
    <span data-omega-no-translate>Do Not Touch</span>
    <input type="submit" value="Send it"/>
    <input type="hidden" value="csrf-token-123"/>`));
  write('about/index.html', PAGE('About - MiniCo', '<p>The consumer about page</p>'));
  write('checkout/index.html', PAGE('Checkout', '<p>Card number</p>'));
  write('admin/panel/index.html', PAGE('Admin', '<p>Secret admin copy</p>'));
  write('skipme/index.html', PAGE('Skipped', '<p>User-excluded page</p>'));
  write('twitter.html', PAGE('Social redirect', '<p>Social</p>'));

  return { root, dist };
}

const CONFIG = {
  brand: { name: 'MiniCo', url: 'https://mini.co' },
  socials: { twitter: 'minico' },
  translation: { languages: ['es', 'ar'], exclude: ['skipme'] },
};

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
  assert.ok(!fs.existsSync(path.join(dist, 'es', 'checkout')), 'system route excluded');
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
  assert.ok(es.includes('property="og:locale" content="es"'));
  assert.ok(es.includes('og:locale:alternate" content="en"'));
  assert.ok(es.includes('og:locale:alternate" content="ar"'));

  // Links: internal rewritten, excluded + external untouched
  assert.ok(es.includes('href="/es/about"'));
  assert.ok(es.includes('href="/checkout"'), 'excluded route link not rewritten');
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

test('translateSite: only-filter limits the run to one page', async () => {
  const { root, dist } = stage();
  const calls = [];

  const stats = await translateSite({ root, outDir: dist, config: CONFIG, send: fakeSend(calls), only: 'about' });

  assert.strictEqual(stats.pages, 1);
  assert.ok(fs.existsSync(path.join(dist, 'es', 'about', 'index.html')));
  assert.ok(!fs.existsSync(path.join(dist, 'es.html')), 'home not translated under only-filter');

  fs.rmSync(root, { recursive: true, force: true });
});

test('translateSite: provider failure falls back to source text and reports', async () => {
  const { root, dist } = stage();

  const stats = await translateSite({
    root, outDir: dist, config: { ...CONFIG, translation: { languages: ['es', 'ar'] } },
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

  // The ar page still ships, carrying the source text
  const ar = fs.readFileSync(path.join(dist, 'ar.html'), 'utf8');
  assert.ok(ar.includes('Grow faster with MiniCo'), 'source text kept on failure');
  assert.ok(ar.includes('lang="ar"'), 'chrome still localized');

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

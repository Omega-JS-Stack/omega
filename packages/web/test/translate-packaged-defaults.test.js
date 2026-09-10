/**
 * The default-page translations PACKAGED with @omega.js/web (#621). The
 * framework's own auth/account/payment/portal chrome is the same copy on every
 * brand, so it is translated ONCE in the framework and read back here: those
 * routes stay out of provider calls (#605) and still get their /{lang}/ copies.
 *
 * The unit half proves the brand sentinel (one packaged entry serves every
 * brand) and the lookup; the integration half drives the REAL translateSite
 * over a handcrafted dist with a fixture packaged cache, and pins the two
 * quiet behaviours — a miss stays in the source language, a route or language
 * the package carries nothing for produces no copy at all, so hreflang and the
 * sitemap keep telling the truth.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { hashKey } = require('@omega.js/devkit/translate');
const {
  SENTINEL,
  pageNamespace,
  normalizeBrand,
  denormalizeBrand,
  packagedLanguages,
  loadPackaged,
  resolvePackaged,
} = require('../src/translate/packaged-defaults.js');
const { translateSite } = require('../src/translate/index.js');

const PAGE = (title, body) => `<!doctype html><html lang="en" dir="ltr"><head>
<title>${title}</title>
<meta name="description" content="A fine page"/>
<meta property="og:url" content="https://mini.co/"/>
<meta property="og:locale" content="en"/>
<link rel="canonical" href="https://mini.co/"/>
</head><body>${body}</body></html>`;

const CONFIG = {
  brand: { name: 'MiniCo', url: 'https://mini.co' },
  translation: { languages: ['es'] },
};

/** A provider that must never be reached — default routes never cost a token. */
const refuse = async () => { throw new Error('a default page must never reach the provider');};

/**
 * Stage a consumer root with a built dist (one brand page + framework default
 * pages) and an empty packaged-translations root to fill per test.
 */
function stage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-packaged-'));
  const dist = path.join(root, 'dist');
  const packaged = path.join(root, 'packaged');

  const write = (rel, html) => {
    fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
    fs.writeFileSync(path.join(dist, rel), html);
  };

  write('index.html', PAGE('Welcome home', '<p>Grow faster with MiniCo</p><a href="/signin">Sign in</a>'));
  write('signin/index.html', PAGE('Sign in to MiniCo', '<p>Email address</p><input type="submit" value="Continue"/>'));
  write('terms/index.html', PAGE('Terms', '<p>These terms bind you.</p>'));

  return { root, dist, packaged };
}

/** Write one packaged namespace file, keys hashed on the SENTINEL form. */
function packageStrings(packaged, lang, route, entries) {
  const file = path.join(packaged, lang, `${pageNamespace(route)}.json`);
  const map = Object.fromEntries(Object.entries(entries).map(([source, value]) => [hashKey(source), value]));

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`);
}

test('the brand sentinel round-trips, so one packaged entry serves every brand', () => {
  const rendered = 'Sign in to MiniCo — MiniCo keeps you signed in';
  const neutral = normalizeBrand(rendered, 'MiniCo');

  assert.strictEqual(neutral, `Sign in to ${SENTINEL} — ${SENTINEL} keeps you signed in`, 'every occurrence is replaced');
  assert.strictEqual(denormalizeBrand(neutral, 'MiniCo'), rendered, 'round trip');

  // The same packaged key, reached from a completely different brand
  assert.strictEqual(normalizeBrand('Sign in to Acme Co', 'Acme Co'), `Sign in to ${SENTINEL}`);
  assert.strictEqual(denormalizeBrand(`Sign in to ${SENTINEL}`, 'Acme Co'), 'Sign in to Acme Co');

  // A string without the brand is untouched, and no brand at all is a no-op
  assert.strictEqual(normalizeBrand('Email address', 'MiniCo'), 'Email address');
  assert.strictEqual(normalizeBrand('Email address', ''), 'Email address');
});

test('the packaged cache spells its namespace exactly like a consumer cache', () => {
  assert.strictEqual(pageNamespace('payment/checkout'), 'pages/payment/checkout');
  assert.strictEqual(pageNamespace(''), 'pages/home');
});

test('resolvePackaged: a hit lands brand-swapped, a miss stays undefined and counts', () => {
  const { root, packaged } = stage();
  packageStrings(packaged, 'es', 'signin', {
    [`Sign in to ${SENTINEL}`]: `Inicia sesión en ${SENTINEL}`,
    'Email address': 'Correo electrónico',
  });

  const cache = loadPackaged(packaged, 'es', 'signin');
  const { translated, hits, misses } = resolvePackaged({
    strings: ['Sign in to MiniCo', 'Email address', 'Something the brand rewrote'],
    brand: 'MiniCo',
    cache,
  });

  // A miss is a hole (the shape the applying walk reads as "leave this node")
  assert.deepStrictEqual(Array.from(translated), ['Inicia sesión en MiniCo', 'Correo electrónico', undefined]);
  assert.strictEqual(hits, 2);
  assert.strictEqual(misses, 1);

  // A language the package ships nothing for is an empty map, never a throw
  assert.deepStrictEqual(loadPackaged(packaged, 'fa', 'signin'), {});

  fs.rmSync(root, { recursive: true, force: true });
});

test('resolvePackaged: a brand named after a chrome word still hits the strings that never mention it', () => {
  const { root, packaged } = stage();
  packageStrings(packaged, 'es', 'signin', {
    'Sign in to your account': 'Inicia sesión en tu cuenta',
    [`Welcome to ${SENTINEL}`]: `Te damos la bienvenida a ${SENTINEL}`,
  });

  // Brand "Sign": normalizing replaces EVERY occurrence, so a chrome string
  // that merely CONTAINS the word hashes to a key the package never held — the
  // raw key recovers it, because that string was packaged un-normalized.
  const { translated, hits, misses } = resolvePackaged({
    strings: ['Sign in to your account', 'Welcome to Sign'],
    brand: 'Sign',
    cache: loadPackaged(packaged, 'es', 'signin'),
  });

  assert.deepStrictEqual(Array.from(translated), ['Inicia sesión en tu cuenta', 'Te damos la bienvenida a Sign']);
  assert.strictEqual(hits, 2);
  assert.strictEqual(misses, 0);

  fs.rmSync(root, { recursive: true, force: true });
});

test('packagedLanguages reads the shipped set off the folders, ignoring anything else', () => {
  const { root, packaged } = stage();
  packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });
  packageStrings(packaged, 'fa', 'signin', { 'Email address': 'نشانی ایمیل' });
  fs.mkdirSync(path.join(packaged, 'notalanguage'), { recursive: true });

  assert.deepStrictEqual(packagedLanguages(packaged), ['es', 'fa']);
  assert.deepStrictEqual(packagedLanguages(path.join(root, 'nothing-here')), []);

  fs.rmSync(root, { recursive: true, force: true });
});

test('#621: a framework default page gets its /{lang}/ copy from the packaged cache, with zero provider calls', async () => {
  const { root, dist, packaged } = stage();
  packageStrings(packaged, 'es', 'signin', {
    [`Sign in to ${SENTINEL}`]: `Inicia sesión en ${SENTINEL}`,
    'Email address': 'Correo electrónico',
    'Continue': 'Continuar',
    'A fine page': 'Una buena página',
  });

  const stats = await translateSite({
    root, outDir: dist, config: CONFIG, packagedRoot: packaged,
    // Every BRAND page is cold and this run refuses the provider, so nothing
    // that lands below can have come from anywhere but the packaged cache.
    cachedOnly: true, send: refuse,
  });

  const copy = fs.readFileSync(path.join(dist, 'es', 'signin', 'index.html'), 'utf8');
  assert.ok(copy.includes('Inicia sesión en MiniCo'), 'the sentinel came back as the CONSUMER brand name');
  assert.ok(copy.includes('Correo electrónico'), 'body text translated');
  assert.ok(copy.includes('Continuar'), 'submit value translated');
  assert.ok(copy.includes('Una buena página'), 'meta description translated');

  // Localized chrome, exactly like a brand page's copy
  assert.ok(copy.includes('lang="es"') && copy.includes('dir="ltr"'));
  assert.ok(copy.includes('<link rel="canonical" href="https://mini.co/es/signin"'));
  assert.ok(copy.includes('property="og:locale" content="es_ES"'));

  assert.strictEqual(stats.defaultPages, 1);
  assert.strictEqual(stats.packagedStrings, 4);
  assert.strictEqual(stats.pages, 0, 'the brand page stayed cold — nothing here came from the provider');

  // The original advertises the copy, and the copy advertises itself
  const original = fs.readFileSync(path.join(dist, 'signin', 'index.html'), 'utf8');
  assert.ok(original.includes('href="https://mini.co/es/signin" hreflang="es"'), 'hreflang stitched into the original');
  assert.ok(copy.includes('hreflang="es"'));

  fs.rmSync(root, { recursive: true, force: true });
});

test('#621: strings the package does not carry stay in the source language and are counted', async () => {
  const { root, dist, packaged } = stage();
  packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });

  const logs = [];
  const stats = await translateSite({
    root, outDir: dist, config: CONFIG, packagedRoot: packaged,
    cachedOnly: true, send: refuse,
    logger: { log: (m) => logs.push(m), warn: () => {}, error: () => {} },
  });

  const copy = fs.readFileSync(path.join(dist, 'es', 'signin', 'index.html'), 'utf8');
  assert.ok(copy.includes('Correo electrónico'), 'the packaged string translated');
  assert.ok(copy.includes('Sign in to MiniCo'), 'the unpackaged title stayed English rather than guessed at');

  assert.strictEqual(stats.packagedStrings, 1);
  assert.strictEqual(stats.packagedMisses, 3);

  const line = logs.find((m) => m.includes('/signin'));
  assert.match(line, /3 not packaged/, 'one log line per route names the miss count');

  fs.rmSync(root, { recursive: true, force: true });
});

test('#621: a route the package carries nothing for gets no copy — the legal pages stay one language', async () => {
  const { root, dist, packaged } = stage();
  packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });

  const logs = [];
  const stats = await translateSite({
    root, outDir: dist, config: CONFIG, packagedRoot: packaged,
    cachedOnly: true, send: refuse,
    logger: { log: (m) => logs.push(m), warn: () => {}, error: () => {} },
  });

  assert.ok(!fs.existsSync(path.join(dist, 'es', 'terms')), '/terms ships no copy — the framework packages no legal translations');
  assert.strictEqual(stats.defaultPages, 1, 'only the route with coverage produced a copy');
  assert.ok(logs.some((m) => m.includes('/terms') && /no packaged translations/.test(m)), 'the skipped route says so, once');

  const original = fs.readFileSync(path.join(dist, 'terms', 'index.html'), 'utf8');
  assert.ok(!original.includes('hreflang="es"'), 'a page with no copy never advertises one');

  fs.rmSync(root, { recursive: true, force: true });
});

test('#621: a language the package does not ship is one log line, not an error', async () => {
  const { root, dist, packaged } = stage();
  packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });

  const logs = [];
  const stats = await translateSite({
    root, outDir: dist, config: { ...CONFIG, translation: { languages: ['es', 'fa'] } }, packagedRoot: packaged,
    cachedOnly: true, send: refuse,
    logger: { log: (m) => logs.push(m), warn: () => {}, error: () => {} },
  });

  assert.ok(fs.existsSync(path.join(dist, 'es', 'signin', 'index.html')), 'the shipped language still lands');
  assert.ok(!fs.existsSync(path.join(dist, 'fa', 'signin')), 'the unshipped language produces nothing');
  assert.deepStrictEqual(stats.failures, [], 'an unshipped language is not a failure');

  const notice = logs.filter((m) => m.includes('ships no translations for fa'));
  assert.strictEqual(notice.length, 1, 'said once for the whole run, not once per page');

  fs.rmSync(root, { recursive: true, force: true });
});

test('#621: a default-page copy joins the sitemap like any other produced page', async () => {
  const { root, dist, packaged } = stage();
  packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });
  fs.writeFileSync(path.join(dist, 'sitemap.xml'), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    '  <url><loc>https://mini.co/signin</loc><priority>0.5</priority></url>',
    '</urlset>',
    '',
  ].join('\n'));

  await translateSite({ root, outDir: dist, config: CONFIG, packagedRoot: packaged, cachedOnly: true, send: refuse });

  const xml = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
  assert.ok(xml.includes('<loc>https://mini.co/es/signin</loc>'), 'the copy is listed');
  assert.match(xml, /hreflang="es" href="https:\/\/mini\.co\/es\/signin"\/>/, 'with its alternate');

  fs.rmSync(root, { recursive: true, force: true });
});

test('#621: a route the brand excluded by hand is left alone, packaged translations and all', async () => {
  const { root, dist, packaged } = stage();
  packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });

  const stats = await translateSite({
    root, outDir: dist, packagedRoot: packaged, cachedOnly: true, send: refuse,
    config: { ...CONFIG, translation: { languages: ['es'], exclude: ['signin'] } },
  });

  assert.ok(!fs.existsSync(path.join(dist, 'es', 'signin')), 'an explicit exclude outranks the packaged cache');
  assert.strictEqual(stats.defaultPages, 0);

  fs.rmSync(root, { recursive: true, force: true });
});

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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'translate-packaged-defaults',
  tests: [
    {
      name: 'the brand sentinel round-trips, so one packaged entry serves every brand',
      run: (ctx) => {
        const rendered = 'Sign in to MiniCo — MiniCo keeps you signed in';
        const neutral = normalizeBrand(rendered, 'MiniCo');

        ctx.expect(neutral, 'every occurrence is replaced').toBe(`Sign in to ${SENTINEL} — ${SENTINEL} keeps you signed in`);
        ctx.expect(denormalizeBrand(neutral, 'MiniCo'), 'round trip').toBe(rendered);

        // The same packaged key, reached from a completely different brand
        ctx.expect(normalizeBrand('Sign in to Acme Co', 'Acme Co')).toBe(`Sign in to ${SENTINEL}`);
        ctx.expect(denormalizeBrand(`Sign in to ${SENTINEL}`, 'Acme Co')).toBe('Sign in to Acme Co');

        // A string without the brand is untouched, and no brand at all is a no-op
        ctx.expect(normalizeBrand('Email address', 'MiniCo')).toBe('Email address');
        ctx.expect(normalizeBrand('Email address', '')).toBe('Email address');
      },
    },

    {
      name: 'the packaged cache spells its namespace exactly like a consumer cache',
      run: (ctx) => {
        ctx.expect(pageNamespace('payment/checkout')).toBe('pages/payment/checkout');
        ctx.expect(pageNamespace('')).toBe('pages/home');
      },
    },

    {
      name: 'resolvePackaged: a hit lands brand-swapped, a miss stays undefined and counts',
      run: (ctx) => {
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
        ctx.expect(Array.from(translated)).toEqual(['Inicia sesión en MiniCo', 'Correo electrónico', undefined]);
        ctx.expect(hits).toBe(2);
        ctx.expect(misses).toBe(1);

        // A language the package ships nothing for is an empty map, never a throw
        ctx.expect(loadPackaged(packaged, 'fa', 'signin')).toEqual({});

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'resolvePackaged: a brand named after a chrome word still hits the strings that never mention it',
      run: (ctx) => {
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

        ctx.expect(Array.from(translated)).toEqual(['Inicia sesión en tu cuenta', 'Te damos la bienvenida a Sign']);
        ctx.expect(hits).toBe(2);
        ctx.expect(misses).toBe(0);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'packagedLanguages reads the shipped set off the folders, ignoring anything else',
      run: (ctx) => {
        const { root, packaged } = stage();
        packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });
        packageStrings(packaged, 'fa', 'signin', { 'Email address': 'نشانی ایمیل' });
        fs.mkdirSync(path.join(packaged, 'notalanguage'), { recursive: true });

        ctx.expect(packagedLanguages(packaged)).toEqual(['es', 'fa']);
        ctx.expect(packagedLanguages(path.join(root, 'nothing-here'))).toEqual([]);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: '#621: a framework default page gets its /{lang}/ copy from the packaged cache, with zero provider calls',
      run: async (ctx) => {
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
        ctx.expect(copy.includes('Inicia sesión en MiniCo'), 'the sentinel came back as the CONSUMER brand name').toBeTruthy();
        ctx.expect(copy.includes('Correo electrónico'), 'body text translated').toBeTruthy();
        ctx.expect(copy.includes('Continuar'), 'submit value translated').toBeTruthy();
        ctx.expect(copy.includes('Una buena página'), 'meta description translated').toBeTruthy();

        // Localized chrome, exactly like a brand page's copy
        ctx.expect(copy.includes('lang="es"') && copy.includes('dir="ltr"')).toBeTruthy();
        ctx.expect(copy.includes('<link rel="canonical" href="https://mini.co/es/signin"')).toBeTruthy();
        ctx.expect(copy.includes('property="og:locale" content="es_ES"')).toBeTruthy();

        ctx.expect(stats.defaultPages).toBe(1);
        ctx.expect(stats.packagedStrings).toBe(4);
        ctx.expect(stats.pages, 'the brand page stayed cold — nothing here came from the provider').toBe(0);

        // The original advertises the copy, and the copy advertises itself
        const original = fs.readFileSync(path.join(dist, 'signin', 'index.html'), 'utf8');
        ctx.expect(original.includes('href="https://mini.co/es/signin" hreflang="es"'), 'hreflang stitched into the original').toBeTruthy();
        ctx.expect(copy.includes('hreflang="es"')).toBeTruthy();

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: '#621: strings the package does not carry stay in the source language and are counted',
      run: async (ctx) => {
        const { root, dist, packaged } = stage();
        packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });

        const logs = [];
        const stats = await translateSite({
          root, outDir: dist, config: CONFIG, packagedRoot: packaged,
          cachedOnly: true, send: refuse,
          logger: { log: (m) => logs.push(m), warn: () => {}, error: () => {} },
        });

        const copy = fs.readFileSync(path.join(dist, 'es', 'signin', 'index.html'), 'utf8');
        ctx.expect(copy.includes('Correo electrónico'), 'the packaged string translated').toBeTruthy();
        ctx.expect(copy.includes('Sign in to MiniCo'), 'the unpackaged title stayed English rather than guessed at').toBeTruthy();

        ctx.expect(stats.packagedStrings).toBe(1);
        ctx.expect(stats.packagedMisses).toBe(3);

        const line = logs.find((m) => m.includes('/signin'));
        ctx.expect(line, 'one log line per route names the miss count').toMatch(/3 not packaged/);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: '#621: a route the package carries nothing for gets no copy — the legal pages stay one language',
      run: async (ctx) => {
        const { root, dist, packaged } = stage();
        packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });

        const logs = [];
        const stats = await translateSite({
          root, outDir: dist, config: CONFIG, packagedRoot: packaged,
          cachedOnly: true, send: refuse,
          logger: { log: (m) => logs.push(m), warn: () => {}, error: () => {} },
        });

        ctx.expect(!fs.existsSync(path.join(dist, 'es', 'terms')), '/terms ships no copy — the framework packages no legal translations').toBeTruthy();
        ctx.expect(stats.defaultPages, 'only the route with coverage produced a copy').toBe(1);
        ctx.expect(logs.some((m) => m.includes('/terms') && /no packaged translations/.test(m)), 'the skipped route says so, once').toBeTruthy();

        const original = fs.readFileSync(path.join(dist, 'terms', 'index.html'), 'utf8');
        ctx.expect(!original.includes('hreflang="es"'), 'a page with no copy never advertises one').toBeTruthy();

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: '#621: a language the package does not ship is one log line, not an error',
      run: async (ctx) => {
        const { root, dist, packaged } = stage();
        packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });

        const logs = [];
        const stats = await translateSite({
          root, outDir: dist, config: { ...CONFIG, translation: { languages: ['es', 'fa'] } }, packagedRoot: packaged,
          cachedOnly: true, send: refuse,
          logger: { log: (m) => logs.push(m), warn: () => {}, error: () => {} },
        });

        ctx.expect(fs.existsSync(path.join(dist, 'es', 'signin', 'index.html')), 'the shipped language still lands').toBeTruthy();
        ctx.expect(!fs.existsSync(path.join(dist, 'fa', 'signin')), 'the unshipped language produces nothing').toBeTruthy();
        ctx.expect(stats.failures, 'an unshipped language is not a failure').toEqual([]);

        const notice = logs.filter((m) => m.includes('ships no translations for fa'));
        ctx.expect(notice.length, 'said once for the whole run, not once per page').toBe(1);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: '#621: a default-page copy joins the sitemap like any other produced page',
      run: async (ctx) => {
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
        ctx.expect(xml.includes('<loc>https://mini.co/es/signin</loc>'), 'the copy is listed').toBeTruthy();
        ctx.expect(xml, 'with its alternate').toMatch(/hreflang="es" href="https:\/\/mini\.co\/es\/signin"\/>/);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: '#621: a brand\'s include list never touches the framework\'s own default pages',
      run: async (ctx) => {
        const { root, dist, packaged } = stage();
        packageStrings(packaged, 'es', 'signin', { 'Email address': 'Correo electrónico' });

        // The narrowest brand list there is: the brand's own pages are scoped to its
        // docs, and the framework's chrome is still translated once, on the framework
        // side (#858's ruling, the shape closed #621 shipped).
        const stats = await translateSite({
          root, outDir: dist, packagedRoot: packaged, cachedOnly: true, send: refuse,
          config: { ...CONFIG, translation: { languages: ['es'], include: ['docs/**'] } },
        });

        const copy = fs.readFileSync(path.join(dist, 'es', 'signin', 'index.html'), 'utf8');
        ctx.expect(copy.includes('Correo electrónico'), 'the packaged copy still ships').toBeTruthy();
        ctx.expect(stats.defaultPages).toBe(1);
        ctx.expect(!fs.existsSync(path.join(dist, 'es', 'index.html')), "the brand's own pages still obey its list").toBeTruthy();

        fs.rmSync(root, { recursive: true, force: true });
      },
    },
  ],
});

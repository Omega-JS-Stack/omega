/**
 * redirects.js — the `targets.web.redirects` path-redirect map (#442):
 *  1. the config read: an ordered [{ from, to, type }] list where `from` may
 *     capture ONE `:name` segment that `to` references, and every malformed
 *     shape is an ERROR (a silently dropped redirect is a live 404 on a URL
 *     printed on real QR codes)
 *  2. the compile: each entry becomes a regex + replacement, so the ONE
 *     pattern engine lives here and both runtimes only ever apply it
 *  3. the build: the map lands in the built 404 page — the only lane static
 *     hosting (gh-pages) gives an unbuilt path — and the page's own module
 *     matches it in the browser
 *  4. the dev server: the same map, served live as a real status-code
 *     redirect, so local QA hits the same destinations
 */
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, before } = require('node:test');
const esbuild = require('esbuild');

const { buildWith, miniData } = require('./lib/build.js');
const { readRedirects, redirectMap } = require('../src/redirects.js');

// DashQR's live case: printed QR codes point at /c/{id} forever.
const REDIRECTS = [
  { from: '/c/:id', to: '/code?id=:id' },
  { from: '/legacy-pricing', to: '/pricing', type: 302 },
  { from: '/gh/:user', to: 'https://github.com/:user' },
];

const CORE_JS = path.join(__dirname, '..', 'core', 'js');
const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-redirect-map-'));
const BUNDLE = path.join(BUNDLE_DIR, 'redirect-map.cjs');

let building = null;

/**
 * The REAL browser matcher, driven through esbuild like every other core/js
 * suite.
 */
async function loadMatcher() {
  building ||= esbuild.build({
    entryPoints: [path.join(CORE_JS, 'libs', 'redirect-map.js')],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
  });
  await building;
  delete require.cache[require.resolve(BUNDLE)];
  return require(BUNDLE);
}

test('an unset key declares nothing', () => {
  assert.deepStrictEqual(readRedirects(undefined), []);
  assert.deepStrictEqual(readRedirects(null), []);
  assert.deepStrictEqual(readRedirects([]), []);
});

test('an entry compiles to its pattern, its replacement and its status', () => {
  assert.deepStrictEqual(readRedirects([{ from: '/c/:id', to: '/code?id=:id' }]), [{
    from: '/c/:id',
    to: '/code?id=:id',
    type: 301,
    pattern: '^/c/([^/]+)/?$',
    target: '/code?id=$1',
  }]);

  const [exact] = readRedirects([{ from: '/legacy-pricing', to: '/pricing', type: 302 }]);
  assert.strictEqual(exact.pattern, '^/legacy\\-pricing/?$', 'an exact `from` carries no capture — and its literal is regex-escaped');
  assert.strictEqual(exact.target, '/pricing');
  assert.strictEqual(exact.type, 302);
});

test('the shape, the pattern and the reference are all checked hard', () => {
  assert.throws(() => readRedirects({ '/c/:id': '/code' }), /targets\.web\.redirects must be a list of \{ from, to, type \} entries — got object/);
  assert.throws(() => readRedirects(['/c/:id']), /targets\.web\.redirects\[0\] must be a \{ from, to, type \} entry — got string/);
  assert.throws(() => readRedirects([{ from: '/c/:id', to: '/code', permanent: true }]), /targets\.web\.redirects\[0\] has an unknown key "permanent" — an entry carries from, to and type/);
  assert.throws(() => readRedirects([{ to: '/code' }]), /targets\.web\.redirects\[0\]\.from must be a path starting with "\/"/);
  assert.throws(() => readRedirects([{ from: 'c/:id', to: '/code' }]), /from must be a path starting with "\/"/);
  assert.throws(() => readRedirects([{ from: '/c/:id', to: 42 }]), /targets\.web\.redirects\[0\]\.to must be a path or an absolute URL — got number/);
  assert.throws(() => readRedirects([{ from: '/c/:id', to: 'code' }]), /to must be a path or an absolute URL/);

  // One captured segment, no more — the wildcard-routing shapes a static host
  // cannot honor fail here instead of half-working.
  assert.throws(() => readRedirects([{ from: '/c/:kind/:id', to: '/code?id=:id' }]), /targets\.web\.redirects\[0\]\.from captures 2 segments — one :name segment per entry/);
  assert.throws(() => readRedirects([{ from: '/c/*', to: '/code' }]), /targets\.web\.redirects\[0\]\.from has an unusable segment "\*"/);
  assert.throws(() => readRedirects([{ from: '/c//:id', to: '/code' }]), /from has an unusable segment ""/);

  // A `to` naming a segment `from` never captured would ship the literal
  // ':id' in the URL.
  assert.throws(() => readRedirects([{ from: '/c/:id', to: '/code?id=:code' }]), /targets\.web\.redirects\[0\]\.to references :code, which \/c\/:id does not capture/);
  assert.throws(() => readRedirects([{ from: '/legacy', to: '/code?id=:id' }]), /to references :id, which \/legacy does not capture/);

  assert.throws(() => readRedirects([{ from: '/c/:id', to: '/code', type: 200 }]), /targets\.web\.redirects\[0\]\.type must be 301, 302, 307 or 308 — got 200/);
  assert.throws(() => readRedirects([{ from: '/c/:id', to: '/code' }, { from: '/c/:other', to: '/x' }]), /targets\.web\.redirects\[1\]\.from "\/c\/:other" already matches redirects\[0\] "\/c\/:id"/);
});

test('a `:name` is a reference only where a capture can sit — elsewhere it is text', () => {
  // A colon mid-word is part of the destination, not a reference: this entry
  // is valid config and its target ships verbatim.
  const [literal] = readRedirects([{ from: '/legacy-info', to: '/search?ref:info' }]);
  assert.strictEqual(literal.target, '/search?ref:info');

  const [mixed] = readRedirects([{ from: '/c/:id', to: '/code?id=:id&ref:info' }]);
  assert.strictEqual(mixed.target, '/code?id=$1&ref:info', 'a real reference and a literal colon coexist');

  // Every boundary a capture legitimately follows still substitutes.
  const boundaries = readRedirects([
    { from: '/c/:id', to: '/code?id=:id' },
    { from: '/p/:id', to: '/product/:id' },
    { from: '/a/:id', to: '/anchors#:id' },
    { from: '/q/:id', to: '/search?q=x&id=:id' },
  ]);
  assert.deepStrictEqual(
    boundaries.map((entry) => entry.target),
    ['/code?id=$1', '/product/$1', '/anchors#$1', '/search?q=x&id=$1'],
  );

  // And a reference at a boundary that `from` never captures still fails loud.
  assert.throws(() => readRedirects([{ from: '/legacy-info', to: '/search?ref=:info' }]), /to references :info, which \/legacy-info does not capture/);
});

test('the emitted map carries only what the browser matches on', () => {
  const json = redirectMap(readRedirects(REDIRECTS));

  assert.deepStrictEqual(JSON.parse(json), [
    { pattern: '^/c/([^/]+)/?$', target: '/code?id=$1' },
    { pattern: '^/legacy\\-pricing/?$', target: '/pricing' },
    { pattern: '^/gh/([^/]+)/?$', target: 'https://github.com/$1' },
  ]);
  assert.strictEqual(redirectMap([]), '', 'no redirects, no map');
});

test('the browser matcher resolves a captured segment, an exact path, and nothing else', async () => {
  const { matchRedirect } = await loadMatcher();
  const entries = JSON.parse(redirectMap(readRedirects(REDIRECTS)));

  assert.strictEqual(matchRedirect(entries, '/c/abc123'), '/code?id=abc123', 'the captured id lands in the target');
  assert.strictEqual(matchRedirect(entries, '/c/abc123/'), '/code?id=abc123', 'a trailing slash is the same request');
  assert.strictEqual(matchRedirect(entries, '/legacy-pricing'), '/pricing', 'an exact `from` needs no capture');
  assert.strictEqual(matchRedirect(entries, '/gh/ianwieds'), 'https://github.com/ianwieds', 'an absolute target leaves the site');

  assert.strictEqual(matchRedirect(entries, '/c'), null, 'the segment is required');
  assert.strictEqual(matchRedirect(entries, '/c/abc/extra'), null, 'one segment, never a subtree');
  assert.strictEqual(matchRedirect(entries, '/legacy-pricingX'), null, 'the pattern is anchored');
  assert.strictEqual(matchRedirect(entries, '/pricing'), null, 'an unmapped path is a real 404');
  assert.strictEqual(matchRedirect([], '/c/abc123'), null, 'no map, no redirect');
});

let pages;
before(async () => {
  pages = await buildWith({ ...miniData, redirects: REDIRECTS }, {}, 'redirects');
});

// The entity forms the two lanes emit: Liquid's `escape` writes numeric
// references, and the production minifier re-quotes the attribute and decodes
// what it no longer needs to escape.
const ENTITIES = { '&#34;': '"', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };

/**
 * The map as the module reads it: the shipped attribute, decoded.
 * @param {string} html - a built 404 page
 * @returns {Array<object>}
 */
function shippedMap(html) {
  const tag = (html.match(/<div[^>]*omega-redirect-map[^>]*>/) || [])[0];
  assert.ok(tag, 'the map rides a data attribute the module reads');

  const value = tag.match(/data-redirects=(?:"([^"]*)"|'([^']*)')/);
  assert.ok(value, 'data-redirects carries it');

  return JSON.parse((value[1] ?? value[2]).replace(/&(?:#\d+|[a-z]+);/g, (entity) => ENTITIES[entity] ?? entity));
}

test('the built 404 page carries the map and the module that applies it', () => {
  const notFound = pages.get('/404');

  assert.ok(notFound, 'the framework 404 page ships');
  assert.ok(notFound.includes('/assets/js/modules/redirect-map.bundle.js'), 'and the module that reads it');

  // The compiled pattern is what ships — the `:name` engine stays in the build.
  assert.deepStrictEqual(shippedMap(notFound), [
    { pattern: '^/c/([^/]+)/?$', target: '/code?id=$1' },
    { pattern: '^/legacy\\-pricing/?$', target: '/pricing' },
    { pattern: '^/gh/([^/]+)/?$', target: 'https://github.com/$1' },
  ]);
});

test('the map survives the PRODUCTION build — the only build that ships', async () => {
  // An inline `application/json` script does NOT: the production minify pass
  // extracts every inline script and esbuild-minifies it, which drops a bare
  // JSON blob as a side-effect-free expression and left an empty map behind.
  const production = await buildWith({ ...miniData, redirects: REDIRECTS }, { environment: 'production' }, 'redirects-prod');

  assert.deepStrictEqual(
    shippedMap(production.get('/404')).map((entry) => entry.target),
    ['/code?id=$1', '/pricing', 'https://github.com/$1'],
  );
});

test('no redirects, no map and no module on the 404 page', async () => {
  const plain = await buildWith(miniData, {}, 'redirects-none');
  const notFound = plain.get('/404');

  assert.ok(notFound.includes('Error 404'), 'the page itself is unchanged');
  assert.ok(!notFound.includes('omega-redirect-map'), 'nothing to match, nothing shipped');
});

test('a redirect never claims a URL the site actually builds', () => {
  // /pricing is a real page in the fixture, and it stays the page — the map
  // only ever answers where the 404 does.
  assert.ok(pages.get('/pricing').includes('<title>'), 'the built page still ships');
  assert.ok(!pages.get('/pricing').includes('omega-redirect-map'), 'and carries no redirect machinery');
});

test('the dev server answers the same map with a real status code', async () => {
  const { devServerOptions } = require('../src/commands/dev.js');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-redirects-'));
  fs.writeFileSync(path.join(out, 'code.html'), 'the code page');

  const entries = readRedirects(REDIRECTS);
  const options = devServerOptions(out, undefined, undefined, entries);
  assert.strictEqual(options.middleware.length, 4, 'the redirect middleware is the LAST word: a real file always answers first');

  const middleware = options.middleware[options.middleware.length - 1];
  const server = http.createServer((req, res) => middleware(req, res, () => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`served:${req.url}`);
  }));
  await new Promise((resolve) => server.listen({ port: 0, host: '127.0.0.1' }, resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const hit = (url) => fetch(`${origin}${url}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });

  try {
    const captured = await hit('/c/abc123');
    assert.strictEqual(captured.status, 301, 'the default is a permanent redirect');
    assert.strictEqual(captured.headers.get('location'), '/code?id=abc123');

    const exact = await hit('/legacy-pricing');
    assert.strictEqual(exact.status, 302, 'the entry\'s own type is what it answers with');
    assert.strictEqual(exact.headers.get('location'), '/pricing');

    const built = await hit('/code.html');
    assert.strictEqual(built.status, 200, 'a real file falls through');
    assert.strictEqual(await built.text(), 'served:/code.html');

    const missing = await hit('/nothing-here');
    assert.strictEqual(missing.status, 200, 'an unmapped miss falls through to the 404 page');
    assert.strictEqual(await missing.text(), 'served:/nothing-here');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('no redirects, no dev middleware at all', () => {
  const { devServerOptions } = require('../src/commands/dev.js');

  assert.strictEqual(devServerOptions('/tmp/site-out-no-redirects').middleware.length, 3,
    'the map is the only reason this middleware exists — the proxy, clean-urls and image fallback are all that is left');
});

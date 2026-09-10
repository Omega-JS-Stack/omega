/**
 * Redirects (#466) — ONE mechanism in the web build, and one thing it is not:
 *
 *  1. the redirect PAGE is the whole consumer surface. A page sets
 *     `redirect.url` on the `modules/utilities/redirect` layout and the build
 *     emits meta-refresh + canonical + noindex, so the hop survives with
 *     JavaScript off and search engines are told where the URL really lives.
 *  2. `targets.web.redirects` is GONE. It could only ever be answered
 *     client-side off the built 404 page (static hosting has no server), so a
 *     TEMPLATED redirect — DashQR's printed `/c/<id>` codes — is a Cloudflare
 *     redirect rule the manager's edge service reconciles, and the web build
 *     answers no redirect config at all.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before } = require('node:test');

const { buildSite, buildWith, miniData, BARE, PKG } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

let pages;
before(async () => {
  pages = await buildWith(miniData, {}, 'redirects');
});

// ─── The redirect PAGE ───────────────────────────────────────────────────────

/**
 * The meta-refresh a redirect page ships, as the browser reads it.
 * @param {string} html - a built page
 * @returns {{ delay: string, url: string, inNoscript: boolean }|null}
 */
function metaRefresh(html) {
  const tag = (html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/i) || [])[0];
  if (!tag) return null;

  const content = tag.match(/content=(?:"([^"]*)"|'([^']*)')/i);
  const [delay, url] = (content[1] ?? content[2]).split(/;\s*url=/i);

  return {
    delay,
    url,
    // The module forwards the querystring and the fragment, so the refresh is
    // the NO-JS half and must never race it.
    inNoscript: new RegExp(`<noscript>[\\s\\S]*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*</noscript>`, 'i').test(html),
  };
}

/**
 * The canonical URL a built page declares.
 * @param {string} html - a built page
 * @returns {string|null}
 */
function canonical(html) {
  const tag = (html.match(/<link[^>]+rel=["']?canonical["']?[^>]*>/i) || [])[0];
  if (!tag) return null;

  const href = tag.match(/href=(?:"([^"]*)"|'([^']*)')/i);
  return href[1] ?? href[2];
}

test('a redirect page emits meta-refresh, canonical and noindex — the destination, not itself', () => {
  const account = pages.get('/account');
  assert.ok(account, 'the framework /account shortlink ships');

  const refresh = metaRefresh(account);
  assert.ok(refresh, '/account carries a meta-refresh');
  assert.strictEqual(refresh.delay, '0', 'with JS off there is nothing to wait for');
  assert.strictEqual(refresh.url, 'https://mini.example.com/dashboard/account', 'a site-relative destination is absolutized against the site url');
  assert.ok(refresh.inNoscript, 'the refresh sits in <noscript> so the module keeps the querystring-forwarding hop');

  assert.strictEqual(canonical(account), 'https://mini.example.com/dashboard/account', 'the canonical is the DESTINATION — this URL is not a page');
  assert.ok(account.includes('<meta name="robots" content="noindex'), 'and the shortlink itself is never indexed');
});

test('an absolute destination ships verbatim', () => {
  const external = pages.get('/test/redirect/external');

  assert.strictEqual(metaRefresh(external).url, 'https://google.com', 'another origin is already absolute');
  assert.strictEqual(canonical(external), 'https://google.com');
});

// #624 — the hop is a LAYOUT asset now (js/layouts/modules/utilities/redirect.js),
// resolved from the manifest by layout name, and applied across the page's whole
// layout CHAIN: /careers renders `blueprint/careers`, which sits ON the redirect
// layout, so keying the lookup on the page's own `layout` alone would leave that
// shortlink with no hop at all.
test('the redirect hop is a layout asset, and reaches a page through the layout CHAIN', () => {
  const SCRIPT = '/assets/js/layouts/modules/utilities/redirect-TEST.js';

  const account = pages.get('/account');
  assert.ok(account.includes(SCRIPT), 'a page on the redirect layout gets its script');
  assert.ok(account.indexOf('/assets/js/main-TEST.js') < account.indexOf(SCRIPT), 'from the foot, after the main bundle');
  assert.ok(!account.includes('/assets/js/modules/'), 'and the fixed-URL modules lane is gone');

  assert.ok(pages.get('/careers').includes(SCRIPT), 'a blueprint sitting on the redirect layout gets it too');
  assert.ok(!pages.get('/pricing').includes(SCRIPT), 'a page on no such layout gets nothing');
});

test('a redirect page the framework ships is noindex — no blueprint re-opens the index', () => {
  // /careers is the shipped default: a `blueprint/careers` layout on top of
  // the redirect layout, forwarding to an external form. Whatever a blueprint
  // in the chain declares, the two head signals must keep agreeing — a URL
  // whose canonical points somewhere else is never its own indexable page.
  const careers = pages.get('/careers');
  assert.ok(careers, 'the framework /careers page ships');

  assert.match(canonical(careers), /^https:\/\/docs\.google\.com\/forms\//, 'the canonical is the form it forwards to');
  assert.ok(careers.includes('<meta name="robots" content="noindex'), 'and the forwarding URL itself is never indexed');
});

test('a destination that is absolute WITHOUT a scheme ships verbatim too', async () => {
  // `contains "://"` was the wrong test for "is this relative?": a
  // protocol-relative destination is already absolute, and prefixing the site
  // url built `https://bare.example.com//cdn.example.com/…`. Only a path — one
  // leading slash — is site-relative.
  // Inside the package, not os.tmpdir (index-posture.test.js): Eleventy matches
  // its ignores against CWD-relative paths.
  const consumerDir = path.join(PKG, '.omega', 'redirects-consumer-src');
  fs.rmSync(consumerDir, { recursive: true, force: true });
  fs.cpSync(BARE, consumerDir, { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'whitepaper.html'), [
    '---',
    'layout: modules/utilities/redirect',
    'permalink: /whitepaper',
    'redirect:',
    '  url: "//cdn.example.com/whitepaper.pdf"',
    '---',
    '',
  ].join('\n'));

  try {
    const built = await buildSite(consumerDir, bareData, {}, 'redirects-consumer');
    const whitepaper = built.get('/whitepaper');
    assert.ok(whitepaper, 'the consumer redirect page builds');

    assert.strictEqual(metaRefresh(whitepaper).url, '//cdn.example.com/whitepaper.pdf', 'protocol-relative is already absolute');
    assert.strictEqual(canonical(whitepaper), '//cdn.example.com/whitepaper.pdf', 'and the canonical says the same thing');
  } finally {
    fs.rmSync(consumerDir, { recursive: true, force: true });
  }
});

test('a page that is not a redirect is canonical to itself and carries no refresh', () => {
  const pricing = pages.get('/pricing');

  assert.strictEqual(metaRefresh(pricing), null, 'nothing to refresh to');
  assert.strictEqual(canonical(pricing), 'https://mini.example.com/pricing');
});

// ─── The retired config lane (#466) ──────────────────────────────────────────

test('the web build carries no redirect config engine at all', () => {
  assert.strictEqual(fs.existsSync(path.join(__dirname, '..', 'src', 'redirects.js')), false,
    'the `targets.web.redirects` pattern engine is deleted — the edge compiles templated redirects now');

  for (const module of ['libs/redirect-map.js', 'modules/redirect-map.js']) {
    assert.strictEqual(fs.existsSync(path.join(__dirname, '..', 'core', 'js', module)), false,
      `${module} was the browser half of the 404 map and goes with it`);
  }
});

test('the built 404 page answers nothing but 404', () => {
  const notFound = pages.get('/404');

  assert.ok(notFound.includes('Error 404'), 'the page itself is unchanged');
  assert.ok(!notFound.includes('omega-redirect-map'), 'no map rides it');
  assert.ok(!notFound.includes('redirect-map.bundle.js'), 'and no module reads one');
});

test('the dev server mounts no redirect middleware — the edge owns those routes, dev sees a 404', () => {
  const { devServerOptions } = require('../src/commands/dev.js');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-redirects-'));

  assert.strictEqual(devServerOptions(out).middleware.length, 3,
    'the auth proxy, clean-urls and the image fallback are all there is');
  assert.strictEqual(devServerOptions.length, 3,
    'and the compiled-map parameter is gone from the signature');
});

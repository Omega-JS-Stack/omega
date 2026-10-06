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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, buildWith, miniData, BARE, PKG } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

let pages;

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

module.exports = defineCases({
  type: 'group',
  description: 'redirects',
  setup: async () => {
    pages = await buildWith(miniData, {}, 'redirects');
  },
  tests: [
    {
      name: 'a redirect page emits meta-refresh, canonical and noindex — the destination, not itself',
      run: (ctx) => {
        const account = pages.get('/account');
        ctx.expect(account, 'the framework /account shortlink ships').toBeTruthy();

        const refresh = metaRefresh(account);
        ctx.expect(refresh, '/account carries a meta-refresh').toBeTruthy();
        ctx.expect(refresh.delay, 'with JS off there is nothing to wait for').toBe('0');
        ctx.expect(refresh.url, 'a site-relative destination is absolutized against the site url').toBe('https://mini.example.com/dashboard/account');
        ctx.expect(refresh.inNoscript, 'the refresh sits in <noscript> so the module keeps the querystring-forwarding hop').toBeTruthy();

        ctx.expect(canonical(account), 'the canonical is the DESTINATION — this URL is not a page').toBe('https://mini.example.com/dashboard/account');
        ctx.expect(account.includes('<meta name="robots" content="noindex'), 'and the shortlink itself is never indexed').toBeTruthy();
      },
    },

    {
      name: 'an absolute destination ships verbatim',
      run: (ctx) => {
        const external = pages.get('/test/redirect/external');

        ctx.expect(metaRefresh(external).url, 'another origin is already absolute').toBe('https://google.com');
        ctx.expect(canonical(external)).toBe('https://google.com');
      },
    },

    // #624 — the hop is a LAYOUT asset now (js/layouts/modules/utilities/redirect.js),
    // resolved from the manifest by layout name, and applied across the page's whole
    // layout CHAIN: /careers renders `blueprint/careers`, which sits ON the redirect
    // layout, so keying the lookup on the page's own `layout` alone would leave that
    // shortlink with no hop at all.
    {
      name: 'the redirect hop is a layout asset, and reaches a page through the layout CHAIN',
      run: (ctx) => {
        const SCRIPT = '/assets/js/layouts/modules/utilities/redirect-TEST.js';

        const account = pages.get('/account');
        ctx.expect(account.includes(SCRIPT), 'a page on the redirect layout gets its script').toBeTruthy();
        ctx.expect(account.indexOf('/assets/js/main-TEST.js') < account.indexOf(SCRIPT), 'from the foot, after the main bundle').toBeTruthy();
        ctx.expect(!account.includes('/assets/js/modules/'), 'and the fixed-URL modules lane is gone').toBeTruthy();

        ctx.expect(pages.get('/careers').includes(SCRIPT), 'a blueprint sitting on the redirect layout gets it too').toBeTruthy();
        ctx.expect(!pages.get('/pricing').includes(SCRIPT), 'a page on no such layout gets nothing').toBeTruthy();
      },
    },

    {
      name: 'a redirect page the framework ships is noindex — no blueprint re-opens the index',
      run: (ctx) => {
        // /careers is the shipped default: a `blueprint/careers` layout on top of
        // the redirect layout, forwarding to an external form. Whatever a blueprint
        // in the chain declares, the two head signals must keep agreeing — a URL
        // whose canonical points somewhere else is never its own indexable page.
        const careers = pages.get('/careers');
        ctx.expect(careers, 'the framework /careers page ships').toBeTruthy();

        ctx.expect(canonical(careers), 'the canonical is the form it forwards to').toMatch(/^https:\/\/docs\.google\.com\/forms\//);
        ctx.expect(careers.includes('<meta name="robots" content="noindex'), 'and the forwarding URL itself is never indexed').toBeTruthy();
      },
    },

    {
      name: 'a destination that is absolute WITHOUT a scheme ships verbatim too',
      run: async (ctx) => {
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
          ctx.expect(whitepaper, 'the consumer redirect page builds').toBeTruthy();

          ctx.expect(metaRefresh(whitepaper).url, 'protocol-relative is already absolute').toBe('//cdn.example.com/whitepaper.pdf');
          ctx.expect(canonical(whitepaper), 'and the canonical says the same thing').toBe('//cdn.example.com/whitepaper.pdf');
        } finally {
          fs.rmSync(consumerDir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a page that is not a redirect is canonical to itself and carries no refresh',
      run: (ctx) => {
        const pricing = pages.get('/pricing');

        ctx.expect(metaRefresh(pricing), 'nothing to refresh to').toBe(null);
        ctx.expect(canonical(pricing)).toBe('https://mini.example.com/pricing');
      },
    },

    // ─── The retired config lane (#466) ──────────────────────────────────────────

    {
      name: 'the web build carries no redirect config engine at all',
      run: (ctx) => {
        ctx.expect(fs.existsSync(path.join(__dirname, '..', 'src', 'redirects.js')), 'the `targets.web.redirects` pattern engine is deleted — the edge compiles templated redirects now').toBe(false);

        for (const module of ['libs/redirect-map.js', 'modules/redirect-map.js']) {
          ctx.expect(fs.existsSync(path.join(__dirname, '..', 'core', 'js', module)), `${module} was the browser half of the 404 map and goes with it`).toBe(false);
        }
      },
    },

    {
      name: 'the built 404 page answers nothing but 404',
      run: (ctx) => {
        const notFound = pages.get('/404');

        ctx.expect(notFound.includes('Error 404'), 'the page itself is unchanged').toBeTruthy();
        ctx.expect(!notFound.includes('omega-redirect-map'), 'no map rides it').toBeTruthy();
        ctx.expect(!notFound.includes('redirect-map.bundle.js'), 'and no module reads one').toBeTruthy();
      },
    },

    {
      name: 'the dev server mounts no redirect middleware — the edge owns those routes, dev sees a 404',
      run: (ctx) => {
        const { devServerOptions } = require('../src/commands/dev.js');
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-redirects-'));

        ctx.expect(devServerOptions(out).middleware.length, 'the auth proxy, clean-urls and the image fallback are all there is').toBe(3);
        ctx.expect(devServerOptions.length, 'and the compiled-map parameter is gone from the signature').toBe(3);
      },
    },
  ],
});

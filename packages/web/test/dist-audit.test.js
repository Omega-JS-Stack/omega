/**
 * The built-output audit checks ([#468](https://github.com/Omega-JS-Stack/omega/issues/468)):
 * the four cheap questions `omega test` asks of a real `dist/` beside the link
 * check ([#430](https://github.com/Omega-JS-Stack/omega/issues/430)) — page
 * meta, anchor fragments, image `alt`, and sitemap orphans.
 *
 * Same doctrine as the link check, so the dist trees here are written to disk
 * for real: every check resolves something against the files a build wrote, and
 * a mocked filesystem would prove nothing about the contract it enforces.
 */
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const jetpack = require('fs-jetpack');

const { auditDist, FRAMEWORK_HASH_ROUTES } = require('../src/dist-audit.js');
const { loadExceptions, loadLinkExceptions, EXCEPTIONS_FILE } = require('../src/link-resolver.js');
const { auditCheckFailures } = require('../src/test/smoke.js');

/** A target root with a `dist/` written from `{ relativePath: contents }`. */
function tmpTarget(dist) {
  const root = jetpack.tmpDir({ prefix: 'omega-audit-' }).path();
  const out = path.join(root, 'dist');
  for (const [file, contents] of Object.entries(dist)) {
    jetpack.write(path.join(out, file), contents);
  }
  return { root, out };
}

/** A page the way the theme's head renders one: titled, described, indexable. */
const page = (title, body = '') => '<html><head>'
  + `<title>${title}</title>`
  + `<meta name="description" content="A page about ${title}."/>`
  + '<meta name="robots" content="index"/>'
  + `</head><body>${body}</body></html>`;

/** The sitemap the same build emits, from the URLs it lists. */
const sitemap = (...urls) => '<?xml version="1.0" encoding="UTF-8"?><urlset>'
  + urls.map((url) => `<url><loc>https://example.com${url === '/' ? '' : url}</loc></url>`).join('')
  + '</urlset>';

/** The shape a healthy build has: every check passes with ZERO exceptions. */
const CLEAN = {
  'index.html': page('Home', '<a href="/about#team">the team</a><img src="/assets/hero.png" alt="A hero"/>'),
  'about.html': page('About', '<h2 id="team">Team</h2><a href="#team">jump</a><img src="/assets/team.png" alt=""/>'),
  'sitemap.xml': sitemap('/', '/about'),
};

module.exports = defineCases({
  type: 'group',
  description: 'dist-audit',
  tests: [
    // ---- (a) meta title and description

    {
      name: '#468: a built page with no meta title or description fails the meta check',
      run: (ctx) => {
        const { out } = tmpTarget({
          ...CLEAN,
          'bare.html': '<html><head></head><body>no head at all</body></html>',
          'sitemap.xml': sitemap('/', '/about', '/bare'),
        });

        const audit = auditDist({ distDir: out });

        ctx.expect(audit.meta.offenders).toEqual(['bare.html → description', 'bare.html → title']);
        ctx.expect(audit.meta.stale).toEqual([]);
      },
    },

    {
      name: '#468: a title or description rendered EMPTY is a missing one',
      run: (ctx) => {
        // The head always emits both tags, so presence proves nothing — a page whose
        // `meta.description` resolved to nothing ships `content=""` and reads as
        // described to any scan that only counts tags.
        const { out } = tmpTarget({
          ...CLEAN,
          'blank.html': '<html><head><title>  </title><meta name="description" content=""/></head><body>x</body></html>',
          'sitemap.xml': sitemap('/', '/about', '/blank'),
        });

        ctx.expect(auditDist({ distDir: out }).meta.offenders).toEqual([
          'blank.html → description',
          'blank.html → title',
        ]);
      },
    },

    {
      name: '#987: a raw `>` inside a quoted `content` does not end the meta tag',
      run: (ctx) => {
        // The production minifier decodes `&lt;`/`&gt;` inside attribute values, so a
        // description that mentions `<11th Floor>` ships the brackets raw.
        const { out } = tmpTarget({
          ...CLEAN,
          'tower.html': '<html><head><title>Orbis Tower</title>'
            + '<meta name="description" content="Orbis Tower <11th Floor> is a map."/></head><body>x</body></html>',
          'sitemap.xml': sitemap('/', '/about', '/tower'),
        });

        ctx.expect(auditDist({ distDir: out }).meta.offenders).toEqual([]);
      },
    },

    {
      name: '#468: a healthy build passes every check with ZERO exceptions',
      run: (ctx) => {
        const audit = auditDist({ distDir: tmpTarget(CLEAN).out });

        for (const check of ['meta', 'fragments', 'alt', 'sitemap']) {
          ctx.expect(audit[check].offenders, `${check}: a healthy build needs no exception list`).toEqual([]);
          ctx.expect(audit[check].stale, `${check}: nothing declared, nothing stale`).toEqual([]);
        }
        ctx.expect(audit.pageCount, 'every html page was read — an empty walk would pass vacuously').toBe(2);
      },
    },

    // ---- (b) anchor fragments

    {
      name: '#468: an anchor fragment that matches no id on the linked page fails',
      run: (ctx) => {
        const { out } = tmpTarget({
          ...CLEAN,
          'index.html': page('Home', '<a href="/about#pricing">pricing</a><a href="#nowhere">self</a>'),
        });

        ctx.expect(auditDist({ distDir: out }).fragments.offenders).toEqual([
          'about.html → #pricing (linked from index.html)',
          'index.html → #nowhere (linked from index.html)',
        ]);
      },
    },

    {
      name: "#468: a fragment on a page the build never wrote is the LINK check's business",
      run: (ctx) => {
        // One failure per break: `/gone` is a dead link, and reporting it twice would
        // make fixing one link look like fixing two things.
        const { out } = tmpTarget({ ...CLEAN, 'index.html': page('Home', '<a href="/gone#anywhere">gone</a>') });

        ctx.expect(auditDist({ distDir: out }).fragments.offenders).toEqual([]);
      },
    },

    {
      name: "#468: a fragment that leaves the site is not this check's business",
      run: (ctx) => {
        const { out } = tmpTarget({
          ...CLEAN,
          'index.html': page('Home', '<a href="https://example.com/x#y">out</a><a href="#">top</a><a href="/about#team">in</a>'),
        });

        ctx.expect(auditDist({ distDir: out }).fragments.offenders).toEqual([]);
      },
    },

    {
      name: '#468: the fragment exception is declared on the page that OWNS the anchor',
      run: (ctx) => {
        // Unlike a link exception (per SOURCE page), an anchor is a fact about the
        // page carrying it: a hash the target routes in JS is right on every page
        // that links it, and 190 nav pages must not each declare the same thing.
        const { root, out } = tmpTarget({
          ...CLEAN,
          'index.html': page('Home', '<a href="/about#pricing">pricing</a>'),
          'blog.html': page('Blog', '<a href="/about#pricing">pricing</a>'),
          'sitemap.xml': sitemap('/', '/about', '/blog'),
        });

        const excused = auditDist({ distDir: out, exceptions: { 'about.html': { fragments: ['#pricing'] } } });
        ctx.expect(excused.fragments.offenders).toEqual([]);
        ctx.expect(excused.fragments.stale).toEqual([]);

        // …and the declaration is itself checked: the id exists now, so the entry
        // stands over a fixed anchor and masks the next break at it.
        jetpack.write(path.join(out, 'about.html'), page('About', '<h2 id="team">Team</h2><h2 id="pricing">Pricing</h2>'));
        const fixed = auditDist({ distDir: out, exceptions: { 'about.html': { fragments: ['#pricing'] } } });
        ctx.expect(fixed.fragments.stale).toEqual(['about.html → #pricing']);

        ctx.expect(loadLinkExceptions(root), 'a fragments-only entry declares no dead links').toEqual({});
      },
    },

    {
      name: "#468: the hashes @omega.js/web's OWN pages route in JS need no consumer exception",
      run: (ctx) => {
        // The account page maps `#billing` onto its `billing-section` element in JS,
        // and the nav links it from every page in the build — a framework-owned
        // pattern no brand can fix, so no brand declares it (the #427 doctrine: the
        // default pages are clean with zero exceptions).
        const { out } = tmpTarget({
          ...CLEAN,
          'index.html': page('Home', '<a href="/dashboard/account#billing">billing</a>'),
          'dashboard/account.html': page('Account', '<div id="billing-section"></div>'),
        });

        const audit = auditDist({ distDir: out });
        ctx.expect(audit.fragments.offenders).toEqual([]);
        ctx.expect(audit.fragments.stale, 'a framework route is never stale — a brand may drop the page').toEqual([]);
      },
    },

    {
      name: '#468: a TRANSLATED copy of a framework page is the same page',
      run: (ctx) => {
        // The translation lane writes `es/contact.html` — the same document under a
        // language prefix, so what the framework routes in JS there is what it routes
        // in English (and a brand that has no English copy still needs no exception).
        const { out } = tmpTarget({
          ...CLEAN,
          'es/index.html': page('Inicio', '<a href="/es/contact#chat">chat</a>'),
          'es/contact.html': page('Contacto'),
          'sitemap.xml': sitemap('/', '/about', '/es', '/es/contact'),
        });

        ctx.expect(auditDist({ distDir: out }).fragments.offenders).toEqual([]);
      },
    },

    {
      name: '#974: the legal blueprint links the account page at /dashboard/account, on hashes it routes',
      run: (ctx) => {
        // `/account` is the redirect page; the account layout builds to
        // dashboard/account.html, whose hashes the page routes in JS. A target with no
        // legal or account page of its own builds both as-is, with zero exceptions.
        const legalDir = path.join(__dirname, '..', 'core', '_layouts', 'blueprint', 'legal');
        const routes = FRAMEWORK_HASH_ROUTES['dashboard/account.html'];

        const links = [];
        for (const file of ['privacy.md', 'terms.md']) {
          for (const match of jetpack.read(path.join(legalDir, file)).matchAll(/((?:\/[\w-]+)*)\/account#([\w-]+)/g)) {
            links.push({ file, prefix: match[1], fragment: match[2] });
          }
        }

        const fragments = [...new Set(links.map((link) => link.fragment))].sort();
        ctx.expect(fragments, 'the account fragments the blueprint links').toEqual(['data-request', 'delete', 'refund']);
        ctx.expect(links.filter((link) => link.prefix !== '/dashboard').map((link) => `${link.file} → ${link.prefix}/account#${link.fragment}`),
          'links that miss /dashboard/account').toEqual([]);
        ctx.expect(fragments.filter((fragment) => !routes.includes(`#${fragment}`)), 'fragments the account page does not route').toEqual([]);
      },
    },

    // ---- (c) image alt

    {
      name: '#468: an <img> with no alt attribute fails, and alt="" is a valid decorative image',
      run: (ctx) => {
        const { out } = tmpTarget({
          ...CLEAN,
          'gallery.html': page('Gallery', '<img src="/assets/a.png"/><img src="/assets/b.png" alt=""/><img alt="c" src="/assets/c.png"/>'),
          'sitemap.xml': sitemap('/', '/about', '/gallery'),
        });

        ctx.expect(auditDist({ distDir: out }).alt.offenders).toEqual(['gallery.html → /assets/a.png']);
      },
    },

    {
      name: '#468: `alt` as the MINIFIER writes it — a valueless attribute — is an alt',
      run: (ctx) => {
        // minify-html collapses `alt=""` to a bare `alt`, which is the shape almost
        // every decorative image in a production build ships in: read as missing, the
        // check reports a wall of images that are already declared decorative.
        const { out } = tmpTarget({
          ...CLEAN,
          'lazy.html': page('Lazy', '<img data-lazy="@src /assets/a.jpg" src="/assets/blank.gif" alt>'
            + '<img data-alt="not an alt" src="/assets/b.jpg">'),
          'sitemap.xml': sitemap('/', '/about', '/lazy'),
        });

        ctx.expect(auditDist({ distDir: out }).alt.offenders).toEqual(['lazy.html → /assets/b.jpg']);
      },
    },

    {
      name: '#987: a raw `>` inside a quoted attribute value does not end the img tag',
      run: (ctx) => {
        // The `alt` sits AFTER the bracket, so a scan that stops at the first `>`
        // never reaches it; the last image has none and is reported by its real src.
        const { out } = tmpTarget({
          ...CLEAN,
          'compare.html': page('Compare', '<img title="a > b" alt="A" src="/assets/a.png">'
            + "<img data-note='c > d' alt src=\"/assets/c.png\"><img title=\"e > f\" src=\"/assets/e.png\">"),
          'sitemap.xml': sitemap('/', '/about', '/compare'),
        });

        ctx.expect(auditDist({ distDir: out }).alt.offenders).toEqual(['compare.html → /assets/e.png']);
      },
    },

    {
      name: '#468: an <img> DISPLAYED as escaped code is not an image the page emits',
      run: (ctx) => {
        // The same rule the link check learned in #521: a <pre> block prints source.
        const { out } = tmpTarget({
          ...CLEAN,
          'docs.html': page('Docs', '<pre><code>&lt;img src="/assets/x.png"&gt;</code></pre><img src="/assets/real.png"/>'),
          'sitemap.xml': sitemap('/', '/about', '/docs'),
        });

        ctx.expect(auditDist({ distDir: out }).alt.offenders).toEqual(['docs.html → /assets/real.png']);
      },
    },

    {
      name: '#468: an alt exception excuses its own page only, and a fixed one is reported',
      run: (ctx) => {
        const { out } = tmpTarget({
          ...CLEAN,
          'a.html': page('A', '<img src="/assets/logo.png"/>'),
          'b.html': page('B', '<img src="/assets/logo.png"/>'),
          'sitemap.xml': sitemap('/', '/about', '/a', '/b'),
        });

        const declared = auditDist({ distDir: out, exceptions: { 'a.html': { alt: ['/assets/logo.png'] } } });
        ctx.expect(declared.alt.offenders).toEqual(['b.html → /assets/logo.png']);
        ctx.expect(declared.alt.stale).toEqual([]);

        const stale = auditDist({ distDir: out, exceptions: { 'about.html': { alt: ['/assets/team.png'] } } });
        ctx.expect(stale.alt.stale).toEqual(['about.html → /assets/team.png']);
      },
    },

    // ---- (d) sitemap orphans

    {
      name: '#468: an indexable built page missing from sitemap.xml is an orphan',
      run: (ctx) => {
        const { out } = tmpTarget({ ...CLEAN, 'pricing.html': page('Pricing') });

        ctx.expect(auditDist({ distDir: out }).sitemap.offenders).toEqual(['pricing.html → /pricing']);
      },
    },

    {
      name: "#468: the orphan check reads the ONE flag off the build, and keeps no URL list",
      run: (ctx) => {
        // #564 made noindex and sitemap membership ONE decision and moved every
        // automatic exclusion into the engine, so the dev surface, /admin/, drafts
        // and redirect stubs all reach this check as the same rendered `noindex`.
        // The check has no families of its own to know about.
        const noindex = (title) => `<html><head><title>${title}</title>`
          + '<meta name="description" content="x"/>'
          + '<meta name="robots" content="noindex"/></head><body>x</body></html>';

        const { out } = tmpTarget({
          ...CLEAN,
          'account.html': noindex('Account'),
          'test/styleguide.html': noindex('Styleguide'),
          'admin/users.html': noindex('Users'),
        });

        ctx.expect(auditDist({ distDir: out }).sitemap.offenders).toEqual([]);

        // And an INDEXABLE page the sitemap forgot is still the finding this check exists for.
        const { out: leaky } = tmpTarget({ ...CLEAN, 'admin/users.html': page('Users') });
        ctx.expect(auditDist({ distDir: leaky }).sitemap.offenders).toEqual(['admin/users.html → /admin/users']);
      },
    },

    {
      name: "#468: the pages a build COPIES from a vendor are not the brand's pages",
      run: (ctx) => {
        // Firebase's self-hosted OAuth helpers land in dist verbatim (titleless,
        // description-less, never in the sitemap) and no brand may edit them, so
        // reporting them would be a permanent failure with no fix on either side.
        const { out } = tmpTarget({
          ...CLEAN,
          '__/auth/handler.html': '<html><head></head><body><img src="/x.png"></body></html>',
          '__/auth/iframe.html': '<html><head></head><body></body></html>',
        });

        const audit = auditDist({ distDir: out });
        for (const check of ['meta', 'alt', 'sitemap']) {
          ctx.expect(audit[check].offenders, `${check}: vendor markup is not audited`).toEqual([]);
        }
        ctx.expect(audit.pageCount, 'and it is not counted as a page of the site').toBe(2);
      },
    },

    {
      name: '#468: a build with no sitemap.xml turns the orphan check off, not loud',
      run: (ctx) => {
        // A brand can suppress the default page; nothing to compare against is not a
        // wall of orphans.
        const { 'sitemap.xml': dropped, ...noSitemap } = CLEAN;
        const audit = auditDist({ distDir: tmpTarget(noSitemap).out });

        ctx.expect(dropped, 'the clean fixture really did ship a sitemap').toBeTruthy();
        ctx.expect(audit.sitemap.offenders).toEqual([]);
        ctx.expect(audit.pageCount, 'the other three checks still ran').toBe(2);
      },
    },

    {
      name: '#468: a whole-check exception is `true`, and it fails once the page is listed',
      run: (ctx) => {
        const { out } = tmpTarget({ ...CLEAN, 'pricing.html': page('Pricing') });

        const excused = auditDist({ distDir: out, exceptions: { 'pricing.html': { sitemap: true } } });
        ctx.expect(excused.sitemap.offenders).toEqual([]);
        ctx.expect(excused.sitemap.stale).toEqual([]);

        const listed = auditDist({
          distDir: tmpTarget({ ...CLEAN, 'pricing.html': page('Pricing'), 'sitemap.xml': sitemap('/', '/about', '/pricing') }).out,
          exceptions: { 'pricing.html': { sitemap: true } },
        });
        ctx.expect(listed.sitemap.stale, 'the page is in the sitemap now — drop the entry').toEqual(['pricing.html']);
      },
    },

    {
      name: '#468: a MOUNTED build reads its own base path, not a site of orphans',
      run: (ctx) => {
        // A project site (brand.url carrying a path) ships every root-relative URL
        // under the mount point, and the sitemap's absolute locs carry it too — while
        // dist paths stay site-relative. Read raw, every page reads as an orphan and
        // every fragment target goes missing.
        const mount = (html) => html.replace('<html>', '<html data-omega-path-prefix="/repo">');
        const { out } = tmpTarget({
          'index.html': mount(page('Home', '<a href="/repo/about#team">the team</a>')),
          'about.html': mount(page('About', '<h2 id="team">Team</h2>')),
          'sitemap.xml': '<?xml version="1.0" encoding="UTF-8"?><urlset>'
            + '<url><loc>https://example.com/repo</loc></url><url><loc>https://example.com/repo/about</loc></url>'
            + '</urlset>',
        });

        const audit = auditDist({ distDir: out });
        ctx.expect(audit.sitemap.offenders).toEqual([]);
        ctx.expect(audit.fragments.offenders).toEqual([]);
      },
    },

    // ---- The exception file, and the smoke-check lines

    {
      name: '#468: the exception file carries one list per check, and the old array is the link list',
      run: (ctx) => {
        const { root } = tmpTarget(CLEAN);

        jetpack.write(path.join(root, EXCEPTIONS_FILE), [
          '{',
          "  // #430: the old shape — an array is, and stays, the link check's list.",
          "  \"blog/tags.html\": ['/blog/tags/a-and-r'],",
          '  "legal/eula.html": {',
          '    // #468: one list per check, on the page that owns the finding.',
          "    meta: ['description'],",
          "    alt: ['/assets/images/seal.png'],",
          '    sitemap: true,',
          '  },',
          '}',
        ].join('\n'));

        ctx.expect(loadExceptions(root)).toEqual({
          'blog/tags.html': { links: ['/blog/tags/a-and-r'] },
          'legal/eula.html': { meta: ['description'], alt: ['/assets/images/seal.png'], sitemap: true },
        });
        ctx.expect(loadLinkExceptions(root)).toEqual({ 'blog/tags.html': ['/blog/tags/a-and-r'] });

        // A check nobody runs is a typo, and a typo that reads as "no exception"
        // turns the declaration off silently.
        jetpack.write(path.join(root, EXCEPTIONS_FILE), { 'legal/eula.html': { images: ['/assets/x.png'] } });
        ctx.expect(() => loadExceptions(root)).toThrow(/images/);
      },
    },

    {
      name: '#468: `omega test` surfaces all four checks as smoke-check failures',
      run: (ctx) => {
        const { root, out } = tmpTarget({
          ...CLEAN,
          'index.html': page('Home', '<a href="/about#pricing">pricing</a><img src="/assets/hero.png"/>'),
          'bare.html': '<html><head></head><body>x</body></html>',
        });

        ctx.expect(auditCheckFailures({ distDir: out, targetRoot: root })).toEqual([
          "missing page meta: bare.html → description; set it in the page's meta: frontmatter",
          "missing page meta: bare.html → title; set it in the page's meta: frontmatter",
          'dead anchor fragment: about.html → #pricing (linked from index.html); add the id to the page or fix the link',
          'image without alt: index.html → /assets/hero.png; add alt (alt="" for a decorative image)',
          "page missing from sitemap.xml: bare.html → /bare; a page kept out of the sitemap must also be noindex (meta.index: false, one decision per #564), or declare 'sitemap: true' for it in config/link-exceptions.json5",
        ]);

        // Declared, and every declaration is itself checked.
        jetpack.write(path.join(root, EXCEPTIONS_FILE), {
          'bare.html': { meta: ['title', 'description'], sitemap: true },
          'about.html': { fragments: ['#pricing'] },
          'index.html': { alt: ['/assets/hero.png', '/assets/gone.png'] },
        });
        ctx.expect(auditCheckFailures({ distDir: out, targetRoot: root })).toEqual([
          `stale alt exception in ${EXCEPTIONS_FILE}: index.html → /assets/gone.png passes now; drop it`,
        ]);
      },
    },
  ],
});

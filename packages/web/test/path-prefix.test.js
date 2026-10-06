/**
 * #355 — serving a built site under a URL PATH (a GitHub Pages project site at
 * `https://<user>.github.io/<repo>/`). The publisher supplies the base path as
 * `OMEGA_PATH_PREFIX`; everything the build emits root-relative carries it.
 *
 * Three lanes, one mechanism each, pinned here:
 *   HTML - the `omega-path-prefix` transform (registered ONLY when a prefix is
 *          set), which rewrites href/src/srcset/action and stamps the value on
 *          <html> for the browser half.
 *   CSS  - the emit step in [assets.js](../src/assets.js) (`url(/assets/fonts/…)`
 *          lives in the theme sheets).
 *   JS   - the runtime helper (core/js/libs/path-prefix.js) reading that stamp.
 *
 * The default lane matters as much as the prefixed one: an unset (or `/`)
 * prefix must leave today's output alone, byte for byte, which is why the
 * transform is not registered at all in that case.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { resolvePathPrefix, prefixUrl, stripPathPrefix, readPathPrefixStamp, prefixHtml, prefixCss } = require('../src/path-prefix.js');
const { pathPrefix, siteUrl } = require('../core/js/libs/path-prefix.js');
const { buildAssets } = require('../src/assets.js');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const ROOT = path.resolve(PKG, '..', '..');
// Per-process out dir (#182): a second suite run must never wipe this one's
// assets mid-flight.
const CSS_OUT = path.join(PKG, '.omega', `path-prefix-css-${process.pid}`);
const JS_OUT = path.join(PKG, '.omega', `path-prefix-js-${process.pid}`);

const buildWith = (siteData, overrides, name) => sharedBuildWith(siteData, overrides, name);

// Pages the mini fixture renders identically on every build (its showcase and
// demo pages carry randomized sample content, and the meta-files carry the
// build's own timestamp — neither is a base-path fact).
const STABLE_PAGES = ['/', '/pricing', '/blog', '/contact', '/download', '/404'];

module.exports = defineCases({
  type: 'group',
  description: 'path-prefix',
  cleanup: () => {
    fs.rmSync(CSS_OUT, { recursive: true, force: true });
    fs.rmSync(JS_OUT, { recursive: true, force: true });
  },
  tests: [
    {
      name: 'resolvePathPrefix: normalizes external input, "/" means no-op',
      run: (ctx) => {
        for (const empty of [undefined, null, '', '   ', '/', '//', '///']) {
          ctx.expect(resolvePathPrefix(empty), `${JSON.stringify(empty)} → no prefix`).toBe('');
        }

        ctx.expect(resolvePathPrefix('/workkit'), 'the canonical form passes through').toBe('/workkit');
        ctx.expect(resolvePathPrefix('workkit'), 'leading slash added').toBe('/workkit');
        ctx.expect(resolvePathPrefix('/workkit/'), 'trailing slash stripped').toBe('/workkit');
        ctx.expect(resolvePathPrefix('  /workkit//  '), 'surrounding space and trailing slashes stripped').toBe('/workkit');
        ctx.expect(resolvePathPrefix('//workkit//docs//'), 'inner doubles collapsed, nesting kept').toBe('/workkit/docs');
        ctx.expect(resolvePathPrefix(resolvePathPrefix('/workkit/')), 'idempotent').toBe('/workkit');
      },
    },

    {
      name: 'prefixUrl: root-relative only — external, protocol-relative, bare-relative and anchors untouched',
      run: (ctx) => {
        ctx.expect(prefixUrl('/assets/css/main.css', '/workkit')).toBe('/workkit/assets/css/main.css');
        ctx.expect(prefixUrl('/', '/workkit'), 'the site root becomes the mount root').toBe('/workkit/');
        ctx.expect(prefixUrl('https://cdn.example.com/x.png', '/workkit')).toBe('https://cdn.example.com/x.png');
        ctx.expect(prefixUrl('//cdn.example.com/x.png', '/workkit')).toBe('//cdn.example.com/x.png');
        ctx.expect(prefixUrl('relative/pic.jpg', '/workkit')).toBe('relative/pic.jpg');
        ctx.expect(prefixUrl('#top', '/workkit')).toBe('#top');
        ctx.expect(prefixUrl('mailto:a@b.co', '/workkit')).toBe('mailto:a@b.co');
        ctx.expect(prefixUrl('/pricing', ''), 'no prefix → identity').toBe('/pricing');
      },
    },

    {
      name: 'stripPathPrefix + readPathPrefixStamp: the route under a mount, and the mount a built page carries (#359)',
      run: (ctx) => {
        ctx.expect(stripPathPrefix('/workkit/pricing', '/workkit'), 'the site-relative route comes back').toBe('/pricing');
        ctx.expect(stripPathPrefix('/workkit', '/workkit'), 'the mount root IS the site root').toBe('/');
        ctx.expect(stripPathPrefix('/workkit/', '/workkit'), 'trailing slash kept as the site root').toBe('/');
        ctx.expect(stripPathPrefix('/workkitchen/pricing', '/workkit'), 'a same-looking sibling segment is not the prefix').toBe('/workkitchen/pricing');
        ctx.expect(stripPathPrefix('/pricing', '/workkit'), 'an unmounted path comes back untouched').toBe('/pricing');
        ctx.expect(stripPathPrefix('/pricing', ''), 'no prefix → identity').toBe('/pricing');
        ctx.expect(stripPathPrefix(prefixUrl('/pricing', '/workkit'), '/workkit'), 'the inverse of prefixUrl').toBe('/pricing');

        ctx.expect(readPathPrefixStamp(prefixHtml('<html lang="en"></html>', '/workkit')), 'the stamp prefixHtml writes reads back').toBe('/workkit');
        ctx.expect(readPathPrefixStamp('<html lang="en"></html>'), 'an unmounted page carries none').toBe('');
        ctx.expect(readPathPrefixStamp('<!DOCTYPE html>\n<HTML DATA-OMEGA-PATH-PREFIX="/workkit/">'), 'case-insensitive, and normalized like every other read').toBe('/workkit');
      },
    },

    {
      name: 'prefixHtml: URL attributes rewritten, data-* and page identity left alone, <html> stamped',
      run: (ctx) => {
        const html = [
          '<!DOCTYPE html>',
          '<html lang="en" data-page-path="/pricing">',
          '<link rel="stylesheet" href="/assets/css/main-abc.css"/>',
          '<script type="module" src="/assets/js/main-abc.js"></script>',
          "<a href='/blog'>blog</a>",
          '<a href="https://example.com/blog">external</a>',
          '<a href="//cdn.example.com/x">protocol-relative</a>',
          '<a href="#top">anchor</a>',
          '<form action="/search"></form>',
          '<img src="/assets/images/a.png" data-src="/assets/images/lazy.png"/>',
          '<source srcset="/a-640.png 640w, https://cdn.x/a-1080.png 1080w, /a-2048.png 2x"/>',
          '</html>',
        ].join('\n');

        const out = prefixHtml(html, '/workkit');

        ctx.expect(out.includes('href="/workkit/assets/css/main-abc.css"'), 'stylesheet href prefixed').toBeTruthy();
        ctx.expect(out.includes('src="/workkit/assets/js/main-abc.js"'), 'script src prefixed').toBeTruthy();
        ctx.expect(out.includes("href='/workkit/blog'"), 'single-quoted href prefixed, quote style kept').toBeTruthy();
        ctx.expect(out.includes('href="https://example.com/blog"'), 'external href untouched').toBeTruthy();
        ctx.expect(out.includes('href="//cdn.example.com/x"'), 'protocol-relative href untouched').toBeTruthy();
        ctx.expect(out.includes('href="#top"'), 'anchor untouched').toBeTruthy();
        ctx.expect(out.includes('action="/workkit/search"'), 'form action prefixed').toBeTruthy();
        ctx.expect(out.includes('src="/workkit/assets/images/a.png"'), 'img src prefixed').toBeTruthy();
        ctx.expect(out.includes('data-src="/assets/images/lazy.png"'), 'data-src untouched (runtime lane owns it)').toBeTruthy();
        ctx.expect(out.includes('srcset="/workkit/a-640.png 640w, https://cdn.x/a-1080.png 1080w, /workkit/a-2048.png 2x"'), 'srcset candidates prefixed individually').toBeTruthy();
        ctx.expect(out.includes('data-page-path="/pricing"'), 'page identity is not a URL — untouched').toBeTruthy();
        ctx.expect(out.includes('<html data-omega-path-prefix="/workkit" lang="en"'), 'the browser half gets the stamp').toBeTruthy();

        ctx.expect(prefixHtml(html, ''), 'no prefix → the document is returned untouched').toBe(html);
      },
    },

    {
      name: 'prefixHtml: a comma INSIDE a srcset candidate URL is not a candidate boundary (#362)',
      run: (ctx) => {
        const html = [
          '<img srcset="data:image/gif;base64,R0lGODlhAQABAAAAACw= 1x, /a-2048.png 2x"/>',
          '<img srcset="/thumb.png?w=100,200 1x, /wide.png?w=300,400 2x"/>',
          '<source srcset="data:image/svg+xml,%3Csvg%3E"/>',
        ].join('\n');

        const out = prefixHtml(html, '/workkit');

        ctx.expect(out.includes('srcset="data:image/gif;base64,R0lGODlhAQABAAAAACw= 1x, /workkit/a-2048.png 2x"'), 'the data-URI candidate stays whole, its root-relative sibling still mounts').toBeTruthy();
        ctx.expect(out.includes('srcset="/workkit/thumb.png?w=100,200 1x, /workkit/wide.png?w=300,400 2x"'), 'a comma in a query string is not a boundary — both candidates mount whole').toBeTruthy();
        ctx.expect(out.includes('srcset="data:image/svg+xml,%3Csvg%3E"'), 'a lone data-URI candidate is untouched').toBeTruthy();
      },
    },

    {
      name: 'prefixCss: url() targets rewritten, data/external/relative untouched',
      run: (ctx) => {
        const css = [
          '@font-face{src:url(/assets/fonts/inter-normal-latin.woff2) format("woff2")}',
          '.a{background:url("/assets/images/hero.png")}',
          ".b{background:url('/assets/images/b.png')}",
          '.c{background:url(https://cdn.x/c.png)}',
          '.d{background:url(//cdn.x/d.png)}',
          '.e{background:url(../images/e.png)}',
          '.f{background:url(data:image/gif;base64,R0lGOD)}',
        ].join('\n');

        const out = prefixCss(css, '/workkit');

        ctx.expect(out.includes('url(/workkit/assets/fonts/inter-normal-latin.woff2)'), 'unquoted font url prefixed').toBeTruthy();
        ctx.expect(out.includes('url("/workkit/assets/images/hero.png")'), 'double-quoted url prefixed').toBeTruthy();
        ctx.expect(out.includes("url('/workkit/assets/images/b.png')"), 'single-quoted url prefixed').toBeTruthy();
        ctx.expect(out.includes('url(https://cdn.x/c.png)'), 'external untouched').toBeTruthy();
        ctx.expect(out.includes('url(//cdn.x/d.png)'), 'protocol-relative untouched').toBeTruthy();
        ctx.expect(out.includes('url(../images/e.png)'), 'relative untouched').toBeTruthy();
        ctx.expect(out.includes('url(data:image/gif;base64,R0lGOD)'), 'data URI untouched').toBeTruthy();

        ctx.expect(prefixCss(css, ''), 'no prefix → the sheet is returned untouched').toBe(css);
      },
    },

    {
      name: 'runtime helper: reads the build stamp, falls back to "/"',
      run: (ctx) => {
        const original = global.document;
        ctx.after(() => { global.document = original; });

        global.document = { documentElement: { dataset: {} } };
        ctx.expect(pathPrefix(), 'unstamped page → the site root').toBe('/');
        ctx.expect(siteUrl('/assets/fa/solid/star.svg'), 'unstamped → identity').toBe('/assets/fa/solid/star.svg');

        global.document = { documentElement: { dataset: { omegaPathPrefix: '/workkit' } } };
        ctx.expect(pathPrefix(), 'the stamped value').toBe('/workkit');
        ctx.expect(siteUrl('/assets/fa/solid/star.svg'), 'asset URL mounted').toBe('/workkit/assets/fa/solid/star.svg');
        ctx.expect(siteUrl('https://cdn.x/a.svg'), 'external untouched').toBe('https://cdn.x/a.svg');
        ctx.expect(siteUrl('relative.svg'), 'bare-relative untouched').toBe('relative.svg');

        global.document = {};
        ctx.expect(pathPrefix(), 'a DOM with no <html> yet → the site root').toBe('/');

        global.document = undefined;
        ctx.expect(pathPrefix(), 'no document (worker scope) → the site root').toBe('/');
      },
    },

    {
      name: 'engine: a prefixed build mounts every emitted URL under the base path',
      run: async (ctx) => {
        const pages = await buildWith(miniData, { pathPrefix: '/workkit' }, 'path-prefix-on');
        const home = pages.get('/');

        ctx.expect(home, 'the home page built').toBeTruthy();
        ctx.expect(home.includes('data-omega-path-prefix="/workkit"'), '<html> carries the stamp').toBeTruthy();
        ctx.expect(home.includes('href="/workkit/assets/css/main-TEST.css"'), 'the main stylesheet is mounted').toBeTruthy();
        ctx.expect(home.includes('src="/workkit/assets/js/main-TEST.js"'), 'the main bundle is mounted').toBeTruthy();
        ctx.expect(home.includes('href="/workkit/assets/fonts/'), 'font preloads are mounted').toBeTruthy();
        ctx.expect(home.includes('href="/workkit/pricing"'), 'internal links are mounted').toBeTruthy();
        ctx.expect(!/href="\/(?!workkit)[a-z]/.test(home), 'no href points back at the domain root').toBeTruthy();
        ctx.expect(!home.includes('href="/workkit/http'), 'external links were not rewritten').toBeTruthy();
        ctx.expect(home.includes('data-page-path="/"'), 'page identity stays the site-relative route').toBeTruthy();
      },
    },

    {
      name: 'engine: an unset (or "/") prefix leaves today\'s output alone, byte for byte',
      run: async (ctx) => {
        const plain = await buildWith(miniData, {}, 'path-prefix-off');
        const slash = await buildWith(miniData, { pathPrefix: '/' }, 'path-prefix-slash');

        for (const url of STABLE_PAGES) {
          ctx.expect(plain.get(url), `${url} built`).toBeTruthy();
          ctx.expect(slash.get(url), `${url}: an explicit "/" is a no-op`).toBe(plain.get(url));
        }

        const home = plain.get('/');
        ctx.expect(!home.includes('data-omega-path-prefix'), 'no stamp on an unprefixed build').toBeTruthy();
        ctx.expect(home.includes('href="/assets/css/main-TEST.css"'), 'asset URLs stay root-relative').toBeTruthy();
      },
    },

    {
      name: 'assets: the built bundles read the stamp instead of the domain root',
      run: async (ctx) => {
        const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];
        await buildAssets({
          layers: [...themeRoots, path.join(PKG, 'core')],
          themeRoots,
          sectionRoots: themeRoots,
          themesDir: path.join(PKG, 'themes'),
          coreDir: path.join(PKG, 'core'),
          outDir: JS_OUT,
          clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
          only: 'js',
          // Dev names + no minify: the point is WHICH code shipped, and a minified
          // bundle renames nothing that matters here but hides the dataset read.
          dev: true,
        });

        const bundles = fs.readdirSync(path.join(JS_OUT, 'assets', 'js'), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
          .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'));

        ctx.expect(bundles.length > 0, 'the js lane built something').toBeTruthy();
        ctx.expect(bundles.some((code) => code.includes('omegaPathPrefix')), 'the runtime helper shipped — some bundle reads the build stamp').toBeTruthy();
        ctx.expect(!bundles.some((code) => /fetch\(`\/assets\/fa\//.test(code)), 'the icon transport no longer fetches from the domain root').toBeTruthy();
      },
    },

    {
      name: 'assets: the css lane mounts its url() targets under the base path',
      run: async (ctx) => {
        const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];
        const base = {
          layers: [...themeRoots, path.join(PKG, 'core')],
          themeRoots,
          sectionRoots: themeRoots,
          themesDir: path.join(PKG, 'themes'),
          coreDir: path.join(PKG, 'core'),
          clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
          only: 'css',
        };

        const plain = await buildAssets({ ...base, outDir: path.join(CSS_OUT, 'plain') });
        const mounted = await buildAssets({ ...base, outDir: path.join(CSS_OUT, 'mounted'), pathPrefix: '/workkit' });

        const read = (out, url) => fs.readFileSync(path.join(out, url.slice(1)), 'utf8');
        const plainCss = read(path.join(CSS_OUT, 'plain'), plain.css.main);
        const mountedCss = read(path.join(CSS_OUT, 'mounted'), mounted.css.main);

        ctx.expect(plainCss.includes('url(/assets/fonts/'), 'the theme sheet ships @font-face src URLs').toBeTruthy();
        ctx.expect(mountedCss.includes('url(/workkit/assets/fonts/'), 'those URLs are mounted under the base path').toBeTruthy();
        ctx.expect(!mountedCss.includes('url(/assets/fonts/'), 'and none is left at the domain root').toBeTruthy();
        ctx.expect(mounted.css.main, 'the content hash follows the bytes actually served').not.toBe(plain.css.main);
      },
    },
  ],
});

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
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');

const { resolvePathPrefix, prefixUrl, stripPathPrefix, readPathPrefixStamp, prefixHtml, prefixCss } = require('../src/path-prefix.js');
const { pathPrefix, siteUrl } = require('../core/js/libs/path-prefix.js');
const { buildAssets } = require('../src/assets.js');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const ROOT = path.resolve(PKG, '..', '..');
// Per-process out dir (#182): a second suite run must never wipe this one's
// assets mid-flight.
const CSS_OUT = path.join(PKG, '.omega', `path-prefix-css-${process.pid}`);
const JS_OUT = path.join(PKG, '.omega', `path-prefix-js-${process.pid}`);

after(() => {
  fs.rmSync(CSS_OUT, { recursive: true, force: true });
  fs.rmSync(JS_OUT, { recursive: true, force: true });
});

const buildWith = (siteData, overrides, name) => sharedBuildWith(siteData, overrides, name);

// Pages the mini fixture renders identically on every build (its showcase and
// demo pages carry randomized sample content, and the meta-files carry the
// build's own timestamp — neither is a base-path fact).
const STABLE_PAGES = ['/', '/pricing', '/blog', '/contact', '/download', '/404'];

test('resolvePathPrefix: normalizes external input, "/" means no-op', () => {
  for (const empty of [undefined, null, '', '   ', '/', '//', '///']) {
    assert.equal(resolvePathPrefix(empty), '', `${JSON.stringify(empty)} → no prefix`);
  }

  assert.equal(resolvePathPrefix('/workkit'), '/workkit', 'the canonical form passes through');
  assert.equal(resolvePathPrefix('workkit'), '/workkit', 'leading slash added');
  assert.equal(resolvePathPrefix('/workkit/'), '/workkit', 'trailing slash stripped');
  assert.equal(resolvePathPrefix('  /workkit//  '), '/workkit', 'surrounding space and trailing slashes stripped');
  assert.equal(resolvePathPrefix('//workkit//docs//'), '/workkit/docs', 'inner doubles collapsed, nesting kept');
  assert.equal(resolvePathPrefix(resolvePathPrefix('/workkit/')), '/workkit', 'idempotent');
});

test('prefixUrl: root-relative only — external, protocol-relative, bare-relative and anchors untouched', () => {
  assert.equal(prefixUrl('/assets/css/main.css', '/workkit'), '/workkit/assets/css/main.css');
  assert.equal(prefixUrl('/', '/workkit'), '/workkit/', 'the site root becomes the mount root');
  assert.equal(prefixUrl('https://cdn.example.com/x.png', '/workkit'), 'https://cdn.example.com/x.png');
  assert.equal(prefixUrl('//cdn.example.com/x.png', '/workkit'), '//cdn.example.com/x.png');
  assert.equal(prefixUrl('relative/pic.jpg', '/workkit'), 'relative/pic.jpg');
  assert.equal(prefixUrl('#top', '/workkit'), '#top');
  assert.equal(prefixUrl('mailto:a@b.co', '/workkit'), 'mailto:a@b.co');
  assert.equal(prefixUrl('/pricing', ''), '/pricing', 'no prefix → identity');
});

test('stripPathPrefix + readPathPrefixStamp: the route under a mount, and the mount a built page carries (#359)', () => {
  assert.equal(stripPathPrefix('/workkit/pricing', '/workkit'), '/pricing', 'the site-relative route comes back');
  assert.equal(stripPathPrefix('/workkit', '/workkit'), '/', 'the mount root IS the site root');
  assert.equal(stripPathPrefix('/workkit/', '/workkit'), '/', 'trailing slash kept as the site root');
  assert.equal(stripPathPrefix('/workkitchen/pricing', '/workkit'), '/workkitchen/pricing', 'a same-looking sibling segment is not the prefix');
  assert.equal(stripPathPrefix('/pricing', '/workkit'), '/pricing', 'an unmounted path comes back untouched');
  assert.equal(stripPathPrefix('/pricing', ''), '/pricing', 'no prefix → identity');
  assert.equal(stripPathPrefix(prefixUrl('/pricing', '/workkit'), '/workkit'), '/pricing', 'the inverse of prefixUrl');

  assert.equal(readPathPrefixStamp(prefixHtml('<html lang="en"></html>', '/workkit')), '/workkit', 'the stamp prefixHtml writes reads back');
  assert.equal(readPathPrefixStamp('<html lang="en"></html>'), '', 'an unmounted page carries none');
  assert.equal(readPathPrefixStamp('<!DOCTYPE html>\n<HTML DATA-OMEGA-PATH-PREFIX="/workkit/">'), '/workkit', 'case-insensitive, and normalized like every other read');
});

test('prefixHtml: URL attributes rewritten, data-* and page identity left alone, <html> stamped', () => {
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

  assert.ok(out.includes('href="/workkit/assets/css/main-abc.css"'), 'stylesheet href prefixed');
  assert.ok(out.includes('src="/workkit/assets/js/main-abc.js"'), 'script src prefixed');
  assert.ok(out.includes("href='/workkit/blog'"), 'single-quoted href prefixed, quote style kept');
  assert.ok(out.includes('href="https://example.com/blog"'), 'external href untouched');
  assert.ok(out.includes('href="//cdn.example.com/x"'), 'protocol-relative href untouched');
  assert.ok(out.includes('href="#top"'), 'anchor untouched');
  assert.ok(out.includes('action="/workkit/search"'), 'form action prefixed');
  assert.ok(out.includes('src="/workkit/assets/images/a.png"'), 'img src prefixed');
  assert.ok(out.includes('data-src="/assets/images/lazy.png"'), 'data-src untouched (runtime lane owns it)');
  assert.ok(
    out.includes('srcset="/workkit/a-640.png 640w, https://cdn.x/a-1080.png 1080w, /workkit/a-2048.png 2x"'),
    'srcset candidates prefixed individually',
  );
  assert.ok(out.includes('data-page-path="/pricing"'), 'page identity is not a URL — untouched');
  assert.ok(out.includes('<html data-omega-path-prefix="/workkit" lang="en"'), 'the browser half gets the stamp');

  assert.equal(prefixHtml(html, ''), html, 'no prefix → the document is returned untouched');
});

test('prefixHtml: a comma INSIDE a srcset candidate URL is not a candidate boundary (#362)', () => {
  const html = [
    '<img srcset="data:image/gif;base64,R0lGODlhAQABAAAAACw= 1x, /a-2048.png 2x"/>',
    '<img srcset="/thumb.png?w=100,200 1x, /wide.png?w=300,400 2x"/>',
    '<source srcset="data:image/svg+xml,%3Csvg%3E"/>',
  ].join('\n');

  const out = prefixHtml(html, '/workkit');

  assert.ok(
    out.includes('srcset="data:image/gif;base64,R0lGODlhAQABAAAAACw= 1x, /workkit/a-2048.png 2x"'),
    'the data-URI candidate stays whole, its root-relative sibling still mounts',
  );
  assert.ok(
    out.includes('srcset="/workkit/thumb.png?w=100,200 1x, /workkit/wide.png?w=300,400 2x"'),
    'a comma in a query string is not a boundary — both candidates mount whole',
  );
  assert.ok(out.includes('srcset="data:image/svg+xml,%3Csvg%3E"'), 'a lone data-URI candidate is untouched');
});

test('prefixCss: url() targets rewritten, data/external/relative untouched', () => {
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

  assert.ok(out.includes('url(/workkit/assets/fonts/inter-normal-latin.woff2)'), 'unquoted font url prefixed');
  assert.ok(out.includes('url("/workkit/assets/images/hero.png")'), 'double-quoted url prefixed');
  assert.ok(out.includes("url('/workkit/assets/images/b.png')"), 'single-quoted url prefixed');
  assert.ok(out.includes('url(https://cdn.x/c.png)'), 'external untouched');
  assert.ok(out.includes('url(//cdn.x/d.png)'), 'protocol-relative untouched');
  assert.ok(out.includes('url(../images/e.png)'), 'relative untouched');
  assert.ok(out.includes('url(data:image/gif;base64,R0lGOD)'), 'data URI untouched');

  assert.equal(prefixCss(css, ''), css, 'no prefix → the sheet is returned untouched');
});

test('runtime helper: reads the build stamp, falls back to "/"', () => {
  const original = global.document;
  after(() => { global.document = original; });

  global.document = { documentElement: { dataset: {} } };
  assert.equal(pathPrefix(), '/', 'unstamped page → the site root');
  assert.equal(siteUrl('/assets/fa/solid/star.svg'), '/assets/fa/solid/star.svg', 'unstamped → identity');

  global.document = { documentElement: { dataset: { omegaPathPrefix: '/workkit' } } };
  assert.equal(pathPrefix(), '/workkit', 'the stamped value');
  assert.equal(siteUrl('/assets/fa/solid/star.svg'), '/workkit/assets/fa/solid/star.svg', 'asset URL mounted');
  assert.equal(siteUrl('https://cdn.x/a.svg'), 'https://cdn.x/a.svg', 'external untouched');
  assert.equal(siteUrl('relative.svg'), 'relative.svg', 'bare-relative untouched');

  global.document = {};
  assert.equal(pathPrefix(), '/', 'a DOM with no <html> yet → the site root');

  global.document = undefined;
  assert.equal(pathPrefix(), '/', 'no document (worker scope) → the site root');
});

test('engine: a prefixed build mounts every emitted URL under the base path', async () => {
  const pages = await buildWith(miniData, { pathPrefix: '/workkit' }, 'path-prefix-on');
  const home = pages.get('/');

  assert.ok(home, 'the home page built');
  assert.ok(home.includes('data-omega-path-prefix="/workkit"'), '<html> carries the stamp');
  assert.ok(home.includes('href="/workkit/assets/css/main-TEST.css"'), 'the main stylesheet is mounted');
  assert.ok(home.includes('src="/workkit/assets/js/main-TEST.js"'), 'the main bundle is mounted');
  assert.ok(home.includes('href="/workkit/assets/fonts/'), 'font preloads are mounted');
  assert.ok(home.includes('href="/workkit/pricing"'), 'internal links are mounted');
  assert.ok(!/href="\/(?!workkit)[a-z]/.test(home), 'no href points back at the domain root');
  assert.ok(!home.includes('href="/workkit/http'), 'external links were not rewritten');
  assert.ok(home.includes('data-page-path="/"'), 'page identity stays the site-relative route');
});

test('engine: an unset (or "/") prefix leaves today\'s output alone, byte for byte', async () => {
  const plain = await buildWith(miniData, {}, 'path-prefix-off');
  const slash = await buildWith(miniData, { pathPrefix: '/' }, 'path-prefix-slash');

  for (const url of STABLE_PAGES) {
    assert.ok(plain.get(url), `${url} built`);
    assert.equal(slash.get(url), plain.get(url), `${url}: an explicit "/" is a no-op`);
  }

  const home = plain.get('/');
  assert.ok(!home.includes('data-omega-path-prefix'), 'no stamp on an unprefixed build');
  assert.ok(home.includes('href="/assets/css/main-TEST.css"'), 'asset URLs stay root-relative');
});

test('assets: the built bundles read the stamp instead of the domain root', async () => {
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

  assert.ok(bundles.length > 0, 'the js lane built something');
  assert.ok(
    bundles.some((code) => code.includes('omegaPathPrefix')),
    'the runtime helper shipped — some bundle reads the build stamp',
  );
  assert.ok(
    !bundles.some((code) => /fetch\(`\/assets\/fa\//.test(code)),
    'the icon transport no longer fetches from the domain root',
  );
});

test('assets: the css lane mounts its url() targets under the base path', async () => {
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

  assert.ok(plainCss.includes('url(/assets/fonts/'), 'the theme sheet ships @font-face src URLs');
  assert.ok(mountedCss.includes('url(/workkit/assets/fonts/'), 'those URLs are mounted under the base path');
  assert.ok(!mountedCss.includes('url(/assets/fonts/'), 'and none is left at the domain root');
  assert.notEqual(mounted.css.main, plain.css.main, 'the content hash follows the bytes actually served');
});

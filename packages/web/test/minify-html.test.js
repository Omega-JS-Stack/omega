/**
 * cp140 — production HTML minification (the UJM minifyHtml successor).
 * Unit: the extraction dance (JSON-LD minified as JSON, inline scripts
 * esbuild-minified, IE conditionals survive keep_comments:false, broken
 * blocks ship verbatim). Integration: the transform mounts for
 * environment 'production' ONLY, and only touches .html outputs — the
 * cp139 meta-files ship exactly as rendered.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const { minifyHtml } = require('../src/minify-html.js');
const { buildWith, miniData } = require('./lib/build.js');

const PAGE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <!-- a comment the minifier should eat -->
    <!--[if lte IE 11]><meta http-equiv="X-UA-Compatible" content="IE=edge"><![endif]-->
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "name": "MiniCo"
      }
    </script>
    <script>
      const greeting = "hello";
      console.log( greeting );
    </script>
    <script src="/assets/js/main.js"></script>
  </head>
  <body>
    <p>
      Spaced      out
    </p>
  </body>
</html>`;

test('minifyHtml: collapses whitespace/comments, JSON-LD stays valid JSON, IE conditional survives', () => {
  const out = minifyHtml(PAGE);

  assert.ok(out.length < PAGE.length, 'output smaller');
  assert.ok(!out.includes('a comment the minifier should eat'), 'comments stripped');
  assert.ok(out.includes('<!--[if lte IE 11]>'), 'IE conditional restored verbatim');

  const jsonLd = out.match(/<script type=["']?application\/ld\+json["']?>(.*?)<\/script>/);
  assert.ok(jsonLd, 'JSON-LD script present');
  assert.deepStrictEqual(JSON.parse(jsonLd[1]), { '@context': 'https://schema.org', name: 'MiniCo' });
  assert.ok(!jsonLd[1].includes('\n'), 'JSON-LD minified');

  assert.ok(out.includes('console.log(greeting)') || out.includes('console.log("hello")'), 'inline script esbuild-minified');
  assert.ok(out.includes('src=/assets/js/main.js') || out.includes('src="/assets/js/main.js"'), 'external script untouched by extraction');
});

test('minifyHtml: broken JSON-LD and unparseable inline scripts ship verbatim — never a failed page', () => {
  const broken = '<script type="application/ld+json">{not json}</script><script>const = broken(</script><p>  ok  </p>';
  const out = minifyHtml(broken);
  assert.ok(out.includes('{not json}'), 'unparseable JSON-LD verbatim');
  assert.ok(out.includes('const = broken('), 'unparseable script verbatim');
});

// #762: the inline-script regex matched the prose `<script src>` inside an
// ordinary head comment and ran to the NEXT `</script>`, so the comment's own
// `-->` landed inside the extracted span and the minifier ate everything up to
// the following comment's close, placeholder included. Every tag between the
// two comments (charset, the motion stamp, the preconnects) vanished silently.
const COMMENTED_HEAD = `<!DOCTYPE html>
<html lang="en">
  <head>
    <!-- Analytics origins: these are plain <script src> fetches, so no
         crossorigin on the preconnect. -->
    <link rel="preconnect" href="https://connect.facebook.net"/>
    <meta charset="utf-8"/>
    <!-- Motion gate: inline and first so the stamp beats first paint. -->
    <script>document.documentElement.setAttribute('data-omega-motion', 'true');</script>
    <!-- The first-paint script, a deferred module. -->
    <script type="module" src="/assets/js/first-paint.js"></script>
    <script>
      // a comment-looking string inside a script body is script text: <!-- keep -->
      const marker = "<!-- not a comment -->";
    </script>
    <title>T</title>
  </head>
  <body><p>hi</p></body>
</html>`;

test('#762: a head comment that mentions <script keeps every tag that follows it', () => {
  const out = minifyHtml(COMMENTED_HEAD);

  assert.ok(out.includes('<meta charset=utf-8>'), 'the charset meta ships');
  assert.ok(out.includes('rel=preconnect'), 'the preconnect ships');
  assert.ok(out.includes('setAttribute("data-omega-motion","true")'), 'the motion stamp ships, minified');
  assert.ok(out.includes('first-paint.js'), 'the module script ships');
  assert.ok(out.includes('<!-- not a comment -->'), 'a comment-shaped string inside a script body is script text');
  assert.ok(!out.includes('Analytics origins'), 'the ordinary comments are still eaten');
});

test('engine: production builds minify .html outputs; dev builds and meta-files stay readable', async () => {
  const prod = await buildWith(miniData, { environment: 'production' }, 'minify-prod');
  const dev = await buildWith(miniData, {}, 'minify-dev');

  const prodHome = prod.get('/');
  const devHome = dev.get('/');
  assert.ok(prodHome.length < devHome.length, 'production page smaller than dev render');
  // IE conditional comments are preserved VERBATIM (indentation and all) —
  // judge minification on everything outside them
  const outsideConditionals = prodHome.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/g, '');
  assert.ok(!/\n\s{4,}</.test(outsideConditionals), 'no indented markup survives in production');
  assert.ok(prodHome.includes('<!--[if lte IE 11]>'), 'the head IE conditional survived the real build');
  assert.ok(prodHome.includes('data-theme-id'), 'markup semantics intact');

  // Meta-files ship exactly as rendered even in production (non-.html outputs)
  assert.ok(prod.get('/robots.txt').includes('\n'), 'robots.txt untouched');
  JSON.parse(prod.get('/pages.json'));
  assert.ok(prod.get('/sitemap.xml').includes('\n  '), 'sitemap keeps its template shape');
});

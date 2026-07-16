// Image cache-breaker — unit coverage for the URL rules plus the
// integration proof that BOTH dev and prod builds stamp local imgs.
const test = require('node:test');
const assert = require('node:assert');
const { cachebreakHtml } = require('../src/cachebreak-html.js');
const { buildWith, miniData } = require('./lib/build.js');

const STAMP = '1752000000000';

test('cachebreakHtml: local src stamped, external/data/empty untouched', () => {
  const html = [
    '<img src="/assets/images/brand/logo.png" alt="a"/>',
    "<img src='relative/pic.jpg'/>",
    '<img src="https://images.unsplash.com/photo-1?w=800"/>',
    '<img src="//cdn.example.com/x.png"/>',
    '<img src="data:image/gif;base64,R0lGOD"/>',
    '<img src=""/>',
  ].join('\n');

  const out = cachebreakHtml(html, STAMP);
  assert.ok(out.includes(`src="/assets/images/brand/logo.png?cb=${STAMP}"`), 'root-relative stamped');
  assert.ok(out.includes(`src='relative/pic.jpg?cb=${STAMP}'`), 'bare-relative stamped, quote style kept');
  assert.ok(out.includes('src="https://images.unsplash.com/photo-1?w=800"'), 'external untouched');
  assert.ok(out.includes('src="//cdn.example.com/x.png"'), 'protocol-relative untouched');
  assert.ok(out.includes('src="data:image/gif;base64,R0lGOD"'), 'data URI untouched');
  assert.ok(out.includes('src=""'), 'empty untouched');
});

test('cachebreakHtml: existing params/cb respected; srcset per-candidate; scope is img/source only', () => {
  const out = cachebreakHtml(
    [
      '<img src="/a.png?v=2"/>',
      '<img src="/b.png?cb=123"/>',
      '<source srcset="/c-640.png 640w, https://cdn.x/c-1080.png 1080w, /c-2048.png 2x"/>',
      '<img data-lazy="@src /lazy.png" src="data:image/gif;base64,R0lGOD"/>',
      '<script src="/app.js"></script>',
      '<a href="/pricing">pricing</a>',
    ].join('\n'),
    STAMP,
  );

  assert.ok(out.includes(`src="/a.png?v=2&cb=${STAMP}"`), 'appends after existing params');
  assert.ok(out.includes('src="/b.png?cb=123"'), 'an explicit cb wins');
  assert.ok(out.includes(`srcset="/c-640.png?cb=${STAMP} 640w, https://cdn.x/c-1080.png 1080w, /c-2048.png?cb=${STAMP} 2x"`), 'srcset candidates stamped individually');
  assert.ok(out.includes('data-lazy="@src /lazy.png"'), 'data-lazy value untouched (runtime lazy-loader owns it)');
  assert.ok(out.includes('<script src="/app.js"></script>'), 'script src out of scope');
  assert.ok(out.includes('href="/pricing"'), 'links out of scope');
});

test('engine: dev AND prod builds stamp local imgs with one build value', async () => {
  const prod = await buildWith(miniData, { environment: 'production' }, 'cachebreak-prod');
  const dev = await buildWith(miniData, {}, 'cachebreak-dev');

  for (const [label, pages] of [['prod', prod], ['dev', dev]]) {
    const proof = pages.get('/cachebreak-proof');
    assert.ok(proof, `${label}: proof page rendered`);
    // The prod minifier may unquote/reorder attributes — assert minify-tolerant
    assert.match(proof, /src="?\/assets\/images\/proof\.png\?cb=\d+"?/, `${label}: local img stamped`);
    assert.match(proof, /src="?https:\/\/cdn\.example\.com\/external\.png"?[\s>]/, `${label}: external img untouched`);
    assert.ok(!/external\.png[^\s>"']*cb=/.test(proof), `${label}: no stamp on the external img`);
    assert.match(proof, /srcset="\/assets\/images\/proof-640\.png\?cb=\d+ 640w, \/assets\/images\/proof-1280\.png\?cb=\d+ 1280w"/, `${label}: srcset candidates stamped`);

    // Every stamp on the page is the SAME per-build value
    const stamps = [...proof.matchAll(/[?&]cb=(\d+)/g)].map((m) => m[1]);
    assert.ok(stamps.length >= 3 && new Set(stamps).size === 1, `${label}: one stamp per build`);
  }
});

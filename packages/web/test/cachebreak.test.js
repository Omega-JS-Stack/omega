// Image cache-breaker — unit coverage for the URL rules plus the
// integration proof that BOTH dev and prod builds stamp local imgs.
const defineCases = require('@omega.js/devkit/test/define-cases');
const { cachebreakHtml } = require('../src/cachebreak-html.js');
const { buildWith, miniData } = require('./lib/build.js');

const STAMP = '1752000000000';

module.exports = defineCases({
  type: 'group',
  description: 'cachebreak',
  tests: [
    {
      name: 'cachebreakHtml: local src stamped, external/data/empty untouched',
      run: (ctx) => {
        const html = [
          '<img src="/assets/images/brand/logo.png" alt="a"/>',
          "<img src='relative/pic.jpg'/>",
          '<img src="https://images.unsplash.com/photo-1?w=800"/>',
          '<img src="//cdn.example.com/x.png"/>',
          '<img src="data:image/gif;base64,R0lGOD"/>',
          '<img src=""/>',
        ].join('\n');

        const out = cachebreakHtml(html, STAMP);
        ctx.expect(out.includes(`src="/assets/images/brand/logo.png?cb=${STAMP}"`), 'root-relative stamped').toBeTruthy();
        ctx.expect(out.includes(`src='relative/pic.jpg?cb=${STAMP}'`), 'bare-relative stamped, quote style kept').toBeTruthy();
        ctx.expect(out.includes('src="https://images.unsplash.com/photo-1?w=800"'), 'external untouched').toBeTruthy();
        ctx.expect(out.includes('src="//cdn.example.com/x.png"'), 'protocol-relative untouched').toBeTruthy();
        ctx.expect(out.includes('src="data:image/gif;base64,R0lGOD"'), 'data URI untouched').toBeTruthy();
        ctx.expect(out.includes('src=""'), 'empty untouched').toBeTruthy();
      },
    },

    {
      name: 'cachebreakHtml: existing params/cb respected; srcset per-candidate; scope is img/source only',
      run: (ctx) => {
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

        ctx.expect(out.includes(`src="/a.png?v=2&cb=${STAMP}"`), 'appends after existing params').toBeTruthy();
        ctx.expect(out.includes('src="/b.png?cb=123"'), 'an explicit cb wins').toBeTruthy();
        ctx.expect(out.includes(`srcset="/c-640.png?cb=${STAMP} 640w, https://cdn.x/c-1080.png 1080w, /c-2048.png?cb=${STAMP} 2x"`), 'srcset candidates stamped individually').toBeTruthy();
        ctx.expect(out.includes('data-lazy="@src /lazy.png"'), 'data-lazy value untouched (runtime lazy-loader owns it)').toBeTruthy();
        ctx.expect(out.includes('<script src="/app.js"></script>'), 'script src out of scope').toBeTruthy();
        ctx.expect(out.includes('href="/pricing"'), 'links out of scope').toBeTruthy();
      },
    },

    {
      name: 'cachebreakHtml: a comma INSIDE a candidate URL is not a candidate boundary (#362)',
      run: (ctx) => {
        const out = cachebreakHtml(
          [
            '<img srcset="data:image/gif;base64,R0lGODlhAQABAAAAACw= 1x, /c-2048.png 2x"/>',
            '<img srcset="/thumb.png?w=100,200 1x, /wide.png?w=300,400 2x"/>',
            '<source srcset="data:image/svg+xml,%3Csvg%3E"/>',
          ].join('\n'),
          STAMP,
        );

        ctx.expect(out.includes(`srcset="data:image/gif;base64,R0lGODlhAQABAAAAACw= 1x, /c-2048.png?cb=${STAMP} 2x"`), 'the data-URI candidate survives byte-identical, its local sibling is still stamped').toBeTruthy();
        ctx.expect(out.includes(`srcset="/thumb.png?w=100,200&cb=${STAMP} 1x, /wide.png?w=300,400&cb=${STAMP} 2x"`), 'a comma in a query string is not a boundary — both candidates keep their params').toBeTruthy();
        ctx.expect(out.includes('srcset="data:image/svg+xml,%3Csvg%3E"'), 'a lone data-URI candidate is untouched').toBeTruthy();
      },
    },

    {
      name: 'engine: dev AND prod builds stamp local imgs with one build value',
      run: async (ctx) => {
        const prod = await buildWith(miniData, { environment: 'production' }, 'cachebreak-prod');
        const dev = await buildWith(miniData, {}, 'cachebreak-dev');

        for (const [label, pages] of [['prod', prod], ['dev', dev]]) {
          const proof = pages.get('/cachebreak-proof');
          ctx.expect(proof, `${label}: proof page rendered`).toBeTruthy();
          // The prod minifier may unquote/reorder attributes — assert minify-tolerant
          ctx.expect(proof, `${label}: local img stamped`).toMatch(/src="?\/assets\/images\/proof\.png\?cb=\d+"?/);
          ctx.expect(proof, `${label}: external img untouched`).toMatch(/src="?https:\/\/cdn\.example\.com\/external\.png"?[\s>]/);
          ctx.expect(!/external\.png[^\s>"']*cb=/.test(proof), `${label}: no stamp on the external img`).toBeTruthy();
          ctx.expect(proof, `${label}: srcset candidates stamped`).toMatch(/srcset="\/assets\/images\/proof-640\.png\?cb=\d+ 640w, \/assets\/images\/proof-1280\.png\?cb=\d+ 1280w"/);

          // Every stamp on the page is the SAME per-build value
          const stamps = [...proof.matchAll(/[?&]cb=(\d+)/g)].map((m) => m[1]);
          ctx.expect(stamps.length >= 3 && new Set(stamps).size === 1, `${label}: one stamp per build`).toBeTruthy();
        }
      },
    },
  ],
});

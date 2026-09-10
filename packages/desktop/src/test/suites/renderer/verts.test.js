// Renderer-layer suite — verifies the verts auto-bind (ads-system phase 4):
// a `[data-omega-vert]` element inserted into the live DOM is picked up by
// renderer.js's MutationObserver wiring and handed to @omega.js/client's verts
// module with the type pinned to 'house'. The harness preload seeds an
// AdSense client into the config ON PURPOSE and no inhouse source — proving
// the pin: the provider lane must never be attempted (no adsbygoogle script,
// no <ins>), and the source-less house render collapses the host.
//
// Runs inside a hidden BrowserWindow. Test bodies are reconstructed via
// `new Function('ctx', body)` — no closures over module scope, so each test
// inlines its own poll helper. The binding marker (data-omega-vert-bound) is a
// DOM attribute because preload-world expandos don't cross contextIsolation.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'renderer',
  description: 'verts auto-bind — live [data-omega-vert] binding, house-lane pin',
  tests: [
    {
      name: 'an inserted [data-omega-vert] element gets bound to the house lane',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for ad binding');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        const el = document.createElement('div');
        el.setAttribute('data-omega-vert', 'display');
        el.setAttribute('data-omega-vert-size', 'banner');
        document.body.appendChild(el);

        await until(() => el.dataset.omegaVertBound);
        ctx.expect(el.dataset.omegaVertBound).toBe('house');
        el.remove();
      },
    },
    {
      name: 'descendants of an inserted subtree bind too',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for ad binding');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        const wrap = document.createElement('div');
        wrap.innerHTML = '<section><div id="vertInner" data-omega-vert></div></section>';
        document.body.appendChild(wrap);

        const inner = document.getElementById('vertInner');
        await until(() => inner.dataset.omegaVertBound);
        ctx.expect(inner.dataset.omegaVertBound).toBe('house');
        wrap.remove();
      },
    },
    {
      name: 'the provider lane is never attempted — no adsbygoogle script or <ins> despite a configured AdSense client',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for ad binding');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        const el = document.createElement('div');
        el.setAttribute('data-omega-vert', 'display');
        document.body.appendChild(el);
        await until(() => el.dataset.omegaVertBound);

        // Give any (wrong) provider-lane attempt a beat to surface, then
        // assert the AdSense machinery never touched the page.
        await new Promise((r) => setTimeout(r, 300));
        ctx.expect(document.querySelector('script[src*="adsbygoogle"]')).toBe(null);
        ctx.expect(document.querySelector('ins.adsbygoogle')).toBe(null);
        el.remove();
      },
    },
    {
      name: 'elements without data-omega-vert are untouched',
      run: async (ctx) => {
        const el = document.createElement('div');
        el.className = 'not-an-ad';
        document.body.appendChild(el);

        await new Promise((r) => setTimeout(r, 200));
        ctx.expect(el.hasAttribute('data-omega-vert-bound')).toBe(false);
        el.remove();
      },
    },
  ],
});

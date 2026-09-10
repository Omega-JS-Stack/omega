// Renderer-layer suite — verifies @omega.js/desktop's zero-setup Bootstrap tooltips: the
// prebuilt Bootstrap bundle (Popper inlined) loads, every
// `[data-bs-toggle="tooltip"]` element is auto-initialized (including ones
// inserted after boot), title changes update the live instance, and removal
// disposes it. Real DOM, real Bootstrap — the tip element actually renders.
//
// The harness wires the renderer Manager in the PRELOAD world (contextIsolation
// — see harness/renderer-preload.js), so instance-level assertions and the
// show trigger go through the `window.__emTestTooltip` probe (page-world
// synthetic mouse events can't reach preload-world listeners). Real
// hover-in-one-world behavior + `window.bootstrap` page exposure are covered
// by consumer boot suites.
//
// Runs inside a hidden BrowserWindow. Test bodies are reconstructed via
// `new Function('ctx', body)` — no closures over module scope, so each test
// inlines its own poll helper.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'renderer',
  description: 'bootstrap tooltips auto-init',
  tests: [
    {
      name: 'the Bootstrap bundle loads — Tooltip is available',
      run: (ctx) => {
        if (!window.__emTestTooltip.available()) {
          throw new Error(`Bootstrap bundle failed to load: ${window.__emTestTooltip.error() || '(no require error — wiring bailed earlier)'}`);
        }
        ctx.expect(window.__emTestTooltip.available()).toBe(true);
      },
    },
    {
      name: 'an inserted [data-bs-toggle="tooltip"] element is auto-initialized and renders its title',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for tooltip');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        const el = document.createElement('button');
        el.type = 'button';
        el.id = 'tt-show';
        el.setAttribute('data-bs-toggle', 'tooltip');
        el.setAttribute('data-bs-title', 'Hello from @omega.js/desktop');
        el.textContent = 'hover me';
        document.body.appendChild(el);

        // The auto-init observer creates the instance without any consumer code.
        await until(() => window.__emTestTooltip.hasInstance('tt-show'));

        const shown = window.__emTestTooltip.showDirect('tt-show');
        ctx.expect(shown).toBe(true);
        await until(() => document.querySelector('.tooltip .tooltip-inner'));
        ctx.expect(document.querySelector('.tooltip .tooltip-inner').textContent).toBe('Hello from @omega.js/desktop');

        // Removing the host while shown must clean up the tip (dispose path).
        el.remove();
        await until(() => !document.querySelector('.tooltip'));
      },
    },
    {
      name: 'changing data-bs-title updates the live instance',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for tooltip');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        const el = document.createElement('button');
        el.type = 'button';
        el.id = 'tt-retitle';
        el.setAttribute('data-bs-toggle', 'tooltip');
        el.setAttribute('data-bs-title', 'before');
        document.body.appendChild(el);
        await until(() => window.__emTestTooltip.hasInstance('tt-retitle'));

        el.setAttribute('data-bs-title', 'after');
        // The observer applies setContent asynchronously (mutation microtask) —
        // give it a beat, then show and assert the rendered text.
        await new Promise((r) => setTimeout(r, 100));
        ctx.expect(window.__emTestTooltip.showDirect('tt-retitle')).toBe(true);
        await until(() => document.querySelector('.tooltip .tooltip-inner'));
        ctx.expect(document.querySelector('.tooltip .tooltip-inner').textContent).toBe('after');

        el.remove();
        await until(() => !document.querySelector('.tooltip'));
      },
    },
    {
      name: 'a title-only host initializes ONCE and the renderer stays responsive (the observer/dispose loop regression)',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for tooltip');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        // A host with a PLAIN `title` (no data-bs-title): Bootstrap's
        // constructor MOVES title → data-bs-original-title, which the
        // observer must read as a live title — reading only title/
        // data-bs-title made it dispose (which RESTORES title) and re-init
        // forever: a MutationObserver microtask storm that froze the whole
        // renderer (found by Somiibo's session-limits boot suite).
        const el = document.createElement('button');
        el.type = 'button';
        el.id = 'tt-title-only';
        el.setAttribute('data-bs-toggle', 'tooltip');
        el.setAttribute('title', 'plain title');
        document.body.appendChild(el);

        await until(() => window.__emTestTooltip.hasInstance('tt-title-only'));

        // The loop starved macrotasks — a timer firing IS the proof the
        // main thread survived the mutation settling.
        const responsive = await new Promise((resolve) => setTimeout(() => resolve(true), 150));
        ctx.expect(responsive).toBe(true);

        // Stable end state: title moved into Bootstrap's bookkeeping, the
        // instance alive, and the tip renders the original text.
        ctx.expect(el.hasAttribute('title')).toBe(false);
        ctx.expect(el.getAttribute('data-bs-original-title')).toBe('plain title');
        ctx.expect(window.__emTestTooltip.hasInstance('tt-title-only')).toBe(true);
        ctx.expect(window.__emTestTooltip.showDirect('tt-title-only')).toBe(true);
        await until(() => document.querySelector('.tooltip .tooltip-inner'));
        ctx.expect(document.querySelector('.tooltip .tooltip-inner').textContent).toBe('plain title');

        el.remove();
        await until(() => !document.querySelector('.tooltip'));
      },
    },
    {
      name: 'removing a tooltip host disposes its instance',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for tooltip lifecycle');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        const el = document.createElement('button');
        el.type = 'button';
        el.id = 'tt-dispose';
        el.setAttribute('data-bs-toggle', 'tooltip');
        el.setAttribute('data-bs-title', 'bye');
        document.body.appendChild(el);
        await until(() => window.__emTestTooltip.hasInstance('tt-dispose'));

        el.remove();
        await until(() => !window.__emTestTooltip.hasInstance('tt-dispose'));
        ctx.expect(window.__emTestTooltip.hasInstance('tt-dispose')).toBe(false);
      },
    },
  ],
});

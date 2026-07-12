// Renderer-layer suite — verifies the `window.em.fontawesome` bridge and the
// REAL auto-render pipeline: an `<i class="fa-solid fa-*">` inserted into the
// live DOM gets the bundled SVG injected by renderer.js's MutationObserver.
//
// Runs inside a hidden BrowserWindow. Test bodies are reconstructed via
// `new Function('ctx', body)` — no closures over module scope, so each test
// inlines its own poll helper.

module.exports = {
  type: 'suite',
  layer: 'renderer',
  description: 'fontawesome bridge + auto-render',
  tests: [
    {
      name: 'window.em.fontawesome.get is exposed and resolves an SVG',
      run: async (ctx) => {
        ctx.expect(typeof window.em.fontawesome.get).toBe('function');
        const svg = await window.em.fontawesome.get('play');
        ctx.expect(typeof svg).toBe('string');
        ctx.expect(svg.startsWith('<svg ')).toBe(true);
        ctx.expect(svg.includes('fill="currentColor"')).toBe(true);
      },
    },
    {
      name: 'unknown icons resolve to null over the bridge',
      run: async (ctx) => {
        const svg = await window.em.fontawesome.get('definitely-not-an-icon-xyz');
        ctx.expect(svg).toBe(null);
      },
    },
    {
      name: 'an inserted <i class="fa-solid fa-play"> gets the SVG injected',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for icon injection');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        const el = document.createElement('i');
        el.className = 'fa-solid fa-play me-2';
        document.body.appendChild(el);

        await until(() => el.querySelector('svg'));
        const svg = el.querySelector('svg');
        ctx.expect(svg.getAttribute('width')).toBe('1em');
        ctx.expect(svg.getAttribute('fill')).toBe('currentColor');
        ctx.expect(el.dataset.omegaFa).toBe('solid/play');
        el.remove();
      },
    },
    {
      name: 'injected SVGs render with overflow visible (FA Pro 7 glyphs overshoot their viewBox)',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for icon injection');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        // fa-lock draws its shackle above the viewBox top (y=-32 in
        // 0 0 384 512) — with the SVG-root default (overflow: hidden) the
        // shackle clips flat. The COMPUTED style is the proof the fix
        // reaches the paint, not just the markup.
        const el = document.createElement('i');
        el.className = 'fa-solid fa-lock';
        document.body.appendChild(el);

        await until(() => el.querySelector('svg'));
        ctx.expect(getComputedStyle(el.querySelector('svg')).overflow).toBe('visible');
        el.remove();
      },
    },
    {
      name: 'fa-brands picks the brands style; modifier classes are not names',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for icon injection');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        const el = document.createElement('i');
        el.className = 'fa-brands fa-fw fa-github';
        document.body.appendChild(el);

        await until(() => el.querySelector('svg'));
        ctx.expect(el.dataset.omegaFa).toBe('brands/github'); // not 'fw'
        el.remove();
      },
    },
    {
      name: 'Pro family/weight classes request the composed style — never a wrong-style fallback (cp111)',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for icon mark');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        // Without a Pro set, `fa-light fa-play` must stay EMPTY (style
        // 'light' resolves null) — the pre-cp111 renderer ignored the class
        // and wrongly injected the SOLID glyph. With Pro supplied it lights
        // up for real; either way an SVG here may only be a non-solid one.
        const el = document.createElement('i');
        el.className = 'fa-light fa-play';
        document.body.appendChild(el);

        await until(() => el.dataset.omegaFa);
        ctx.expect(el.dataset.omegaFa).toBe('light/play'); // family/weight classes are never names
        const lightSvg = await window.em.fontawesome.get('play', 'light');
        await new Promise((r) => setTimeout(r, 150));
        ctx.expect((el.querySelector('svg') !== null)).toBe(lightSvg !== null);

        // sharp + weight composes: `fa-sharp fa-light` asks for sharp-light.
        const sharpSvg = await window.em.fontawesome.get('play', 'sharp-light');
        const el2 = document.createElement('i');
        el2.className = 'fa-sharp fa-light fa-play';
        document.body.appendChild(el2);
        await until(() => el2.dataset.omegaFa === 'sharp-light/play');
        await new Promise((r) => setTimeout(r, 150));
        ctx.expect((el2.querySelector('svg') !== null)).toBe(sharpSvg !== null);

        el.remove();
        el2.remove();
      },
    },
    {
      name: 'changing fa-* classes on a RENDERED element re-renders it in place (cp112)',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for icon swap');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        const el = document.createElement('i');
        el.className = 'fa-solid fa-play';
        document.body.appendChild(el);
        await until(() => el.dataset.omegaFa === 'solid/play' && el.querySelector('svg'));
        const playSvg = el.innerHTML;

        // The dynamic MUST: set fa-{icon} via JS on an EXISTING element.
        el.className = 'fa-solid fa-lock';
        await until(() => el.dataset.omegaFa === 'solid/lock' && el.querySelector('svg'));
        ctx.expect(el.innerHTML !== playSvg).toBe(true);

        // Dropping the icon classes clears the rendered SVG.
        el.className = 'me-2';
        await until(() => !el.dataset.omegaFa);
        ctx.expect(el.querySelector('svg')).toBe(null);
        el.remove();
      },
    },
    {
      name: 'unknown icon names leave the element empty (marked, no SVG)',
      run: async (ctx) => {
        const until = async (fn) => {
          const t0 = Date.now();
          while (!fn()) {
            if (Date.now() - t0 > 3000) throw new Error('timed out waiting for icon mark');
            await new Promise((r) => setTimeout(r, 25));
          }
        };

        const el = document.createElement('i');
        el.className = 'fa-solid fa-definitely-not-an-icon-xyz';
        document.body.appendChild(el);

        await until(() => el.dataset.omegaFa);
        // Give the (null) resolution a beat to land, then assert no SVG appeared.
        await new Promise((r) => setTimeout(r, 150));
        ctx.expect(el.querySelector('svg')).toBe(null);
        el.remove();
      },
    },
  ],
};

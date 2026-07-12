// Main-process tests for lib/fontawesome.js — icon resolution across the
// root chain (brand set → free floor), alias coverage, style shape checks,
// name sanitization (the IPC channel must never read outside the icon
// directories), caching, and the IPC round-trip.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'fontawesome (main)',
  tests: [
    {
      name: 'manager.fontawesome is initialized with the full API surface',
      run: (ctx) => {
        ctx.expect(ctx.manager.fontawesome._initialized).toBe(true);
        ctx.expect(typeof ctx.manager.fontawesome.get).toBe('function');
        ctx.expect(typeof ctx.manager.fontawesome.has).toBe('function');
      },
    },
    {
      name: 'get() resolves a solid icon to an inline SVG sized 1em/currentColor',
      run: (ctx) => {
        const svg = ctx.manager.fontawesome.get('play');
        ctx.expect(typeof svg).toBe('string');
        ctx.expect(svg.startsWith('<svg ')).toBe(true);
        ctx.expect(svg.includes('width="1em"')).toBe(true);
        ctx.expect(svg.includes('height="1em"')).toBe(true);
        ctx.expect(svg.includes('fill="currentColor"')).toBe(true);
        ctx.expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      },
    },
    {
      name: 'served SVGs carry overflow="visible" — FA 7 glyphs may draw outside their viewBox',
      run: (ctx) => {
        // fa-lock's shackle peaks at y=-32 in a 0 0 384 512 viewBox; the SVG
        // root default (overflow: hidden) clips it — FA's own kit renders
        // with overflow visible, so the serve path must too.
        const svg = ctx.manager.fontawesome.get('lock');
        ctx.expect(typeof svg).toBe('string');
        ctx.expect(svg.includes('overflow="visible"')).toBe(true);
      },
    },
    {
      name: 'solid is the default style; brands resolve when named',
      run: (ctx) => {
        ctx.expect(ctx.manager.fontawesome.get('rocket')).toBe(ctx.manager.fontawesome.get('rocket', 'solid'));
        const brand = ctx.manager.fontawesome.get('github', 'brands');
        ctx.expect(typeof brand).toBe('string');
        ctx.expect(brand.startsWith('<svg ')).toBe(true);
      },
    },
    {
      name: 'FA aliases resolve (via the fontawesome-free metadata map)',
      run: (ctx) => {
        // 'search' is the classic alias of 'magnifying-glass'.
        ctx.expect(ctx.manager.fontawesome.has('search')).toBe(true);
        ctx.expect(ctx.manager.fontawesome.has('magnifying-glass')).toBe(true);
      },
    },
    {
      name: 'unknown names and unknown styles return null (never throw)',
      run: (ctx) => {
        ctx.expect(ctx.manager.fontawesome.get('definitely-not-an-icon-xyz')).toBe(null);
        // 'no-such-style' is shape-valid but exists in NO Font Awesome set —
        // stays null even after a brand supplies Pro (whose styles, like
        // duotone, are legitimate lookups now).
        ctx.expect(ctx.manager.fontawesome.get('play', 'no-such-style')).toBe(null);
        ctx.expect(ctx.manager.fontawesome.get('play', '../solid')).toBe(null);
        ctx.expect(ctx.manager.fontawesome.has('definitely-not-an-icon-xyz')).toBe(false);
      },
    },
    {
      name: 'OMEGA_FONTAWESOME_ROOT wins the root chain; free stays as fallthrough (cp111)',
      run: (ctx) => {
        const os = require('os');
        const path = require('path');
        const jetpack = require('fs-jetpack');
        const fa = ctx.manager.fontawesome;

        const brandRoot = path.join(os.tmpdir(), `omega-fa-test-${process.pid}`);
        jetpack.write(
          path.join(brandRoot, 'svgs', 'solid', 'omega-test-glyph.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/></svg>',
        );

        const savedEnv = process.env.OMEGA_FONTAWESOME_ROOT;
        const savedRoots = fa._roots;
        try {
          process.env.OMEGA_FONTAWESOME_ROOT = brandRoot;
          fa._roots = fa._resolveRoots();
          fa._cache.clear();
          fa._aliasMap = null;

          ctx.expect(fa._roots[0]).toBe(brandRoot);
          // the brand-only glyph resolves from the env root…
          ctx.expect(fa.get('omega-test-glyph').includes('<svg')).toBe(true);
          // …while icons the brand set lacks still come from the free floor,
          // and aliases still resolve (metadata falls through too).
          ctx.expect(fa.has('play')).toBe(true);
          ctx.expect(fa.has('search')).toBe(true);
        } finally {
          if (savedEnv === undefined) delete process.env.OMEGA_FONTAWESOME_ROOT;
          else process.env.OMEGA_FONTAWESOME_ROOT = savedEnv;
          fa._roots = savedRoots;
          fa._cache.clear();
          fa._aliasMap = null;
          jetpack.remove(brandRoot);
        }
      },
    },
    {
      name: 'non-slug names are rejected — no path traversal, no crashes',
      run: (ctx) => {
        ctx.expect(ctx.manager.fontawesome.get('../../package')).toBe(null);
        ctx.expect(ctx.manager.fontawesome.get('..')).toBe(null);
        ctx.expect(ctx.manager.fontawesome.get('play.svg/../../secrets')).toBe(null);
        ctx.expect(ctx.manager.fontawesome.get('')).toBe(null);
        ctx.expect(ctx.manager.fontawesome.get(null)).toBe(null);
        ctx.expect(ctx.manager.fontawesome.get(42)).toBe(null);
        ctx.expect(ctx.manager.fontawesome.get('Play')).toBe(null); // uppercase is not a slug
      },
    },
    {
      name: 'lookups are cached — same string instance on repeat calls',
      run: (ctx) => {
        const first = ctx.manager.fontawesome.get('play');
        const second = ctx.manager.fontawesome.get('play');
        ctx.expect(first === second).toBe(true);
      },
    },
    {
      name: 'desktop:fontawesome:get IPC handler round-trips (and nulls bad input)',
      run: async (ctx) => {
        const ok = await ctx.manager.ipc.invoke('desktop:fontawesome:get', { name: 'play', style: 'solid' });
        ctx.expect(typeof ok.svg).toBe('string');
        ctx.expect(ok.svg.startsWith('<svg ')).toBe(true);

        const bad = await ctx.manager.ipc.invoke('desktop:fontawesome:get', { name: '../../etc/passwd' });
        ctx.expect(bad.svg).toBe(null);

        const empty = await ctx.manager.ipc.invoke('desktop:fontawesome:get', {});
        ctx.expect(empty.svg).toBe(null);
      },
    },
  ],
};

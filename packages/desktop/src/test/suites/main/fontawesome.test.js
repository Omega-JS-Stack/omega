// Main-process tests for lib/fontawesome.js — bundled-icon resolution, alias
// coverage, style whitelist, name sanitization (the IPC channel must never
// read outside the icon directories), caching, and the IPC round-trip.

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
      name: 'served SVGs carry overflow="visible" — FA Pro 7 glyphs may draw outside their viewBox',
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
      name: 'FA aliases resolve (the download ships them as real files)',
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
        ctx.expect(ctx.manager.fontawesome.get('play', 'duotone')).toBe(null);
        ctx.expect(ctx.manager.fontawesome.has('definitely-not-an-icon-xyz')).toBe(false);
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

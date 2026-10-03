/**
 * icon-core tests — the shared Font Awesome semantics (C4 cp108): name/style
 * validation, candidate lookup order, root-attribute injection, and alias
 * mapping. ESM like its siblings, required straight from dist (require(esm))
 * like desktop main does.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const { createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

const DIST_PATH = path.join(__dirname, '..', 'dist', 'modules', 'icon-core.js');

module.exports = defineCases({
  type: 'group',
  description: 'icon-core',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let core;

      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (() => {
        core = require(DIST_PATH);
      })()));

      cases.push({
        name: 'icon-core > validates names as lowercase slugs and styles by path-safe shape',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.expect(core.isValidIconName('magnifying-glass')).toBe(true);
          ctx.expect(core.isValidIconName('Play')).toBe(false);
          ctx.expect(core.isValidIconName('../../etc/passwd')).toBe(false);
          ctx.expect(core.isValidIconName('')).toBe(false);
          ctx.expect(core.isValidIconName(42)).toBe(false);

          ctx.expect(core.isValidStyle('solid')).toBe(true);
          ctx.expect(core.isValidStyle('regular')).toBe(true);
          ctx.expect(core.isValidStyle('brands')).toBe(true);
          // Pro styles pass the shape check — existence is the file lookup's job.
          ctx.expect(core.isValidStyle('duotone')).toBe(true);
          ctx.expect(core.isValidStyle('sharp-light')).toBe(true);
          // but path-unsafe or non-slug values never do
          ctx.expect(core.isValidStyle('../solid')).toBe(false);
          ctx.expect(core.isValidStyle('Solid')).toBe(false);
          ctx.expect(core.isValidStyle('')).toBe(false);
          ctx.expect(core.isValidStyle(null)).toBe(false);
        },
      });

      cases.push({
        name: 'icon-core > prefers Pro over free in the package order',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.expect(core.PACKAGES).toEqual([
            '@fortawesome/fontawesome-pro',
            '@fortawesome/fontawesome-free',
          ]);
        },
      });

      cases.push({
        name: 'icon-core > parses fa-* class lists the way Font Awesome does (family × weight)',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const parse = (classes) => core.parseIconClasses(classes.split(' '));

          ctx.expect(parse('fa-solid fa-play me-2')).toEqual({ name: 'play', style: 'solid' });
          ctx.expect(parse('fa-play')).toEqual({ name: 'play', style: 'solid' }); // weight defaults
          ctx.expect(parse('fa-brands fa-github')).toEqual({ name: 'github', style: 'brands' });
          ctx.expect(parse('fa-light fa-play')).toEqual({ name: 'play', style: 'light' });
          ctx.expect(parse('fa-sharp fa-light fa-play')).toEqual({ name: 'play', style: 'sharp-light' });
          ctx.expect(parse('fa-duotone fa-play')).toEqual({ name: 'play', style: 'duotone' }); // bare duotone dir
          ctx.expect(parse('fa-duotone fa-thin fa-play')).toEqual({ name: 'play', style: 'duotone-thin' });
          ctx.expect(parse('fa-sharp-duotone fa-play')).toEqual({ name: 'play', style: 'sharp-duotone-solid' });

          // modifiers are never names; no name → null
          ctx.expect(parse('fa-solid fa-fw fa-2x fa-spin fa-rocket')).toEqual({ name: 'rocket', style: 'solid' });
          ctx.expect(parse('fa-solid fa-fw')).toBe(null);
          ctx.expect(parse('btn btn-primary')).toBe(null);
        },
      });

      cases.push({
        name: 'icon-core > #619: country flags are the second namespace, on the same lookup',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const parse = (classes) => core.parseIconClasses(classes.split(' '));

          ctx.expect(parse('omega-flag omega-flag-us')).toEqual({ name: 'us', style: 'flags' });
          ctx.expect(parse('omega-flag omega-flag-jp me-2')).toEqual({ name: 'jp', style: 'flags' });
          // The namespace WINS over any fa-* class beside it — a flag is a flag.
          ctx.expect(parse('fa-solid fa-rocket omega-flag-us')).toEqual({ name: 'us', style: 'flags' });
          // The bare marker class names no country, so it names no icon.
          ctx.expect(parse('omega-flag')).toBe(null);
        },
      });

      cases.push({
        name: 'icon-core > #183: every size class the shared sheet ships parses as a modifier, not a name',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const parse = (classes) => core.parseIconClasses(classes.split(' '));

          // The literal roster of @omega.js/web's icon sheet $fa-sizes map, which
          // packages/web/test/icons.test.js pins from the sheet side, so a size
          // added to one side without the other fails a test either way. A size
          // missing here reads as an icon NAME and the renderer hunts for a glyph
          // called '4xl' instead of sizing the real one.
          const SIZES = ['2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'];

          for (const size of SIZES) {
            ctx.expect(parse(`fa-solid fa-${size} fa-rocket`), `fa-${size} is a modifier`).toEqual({ name: 'rocket', style: 'solid' });
            ctx.expect(parse(`fa-solid fa-${size}`), `fa-${size} alone names no icon`).toBe(null);
          }
        },
      });

      cases.push({
        name: 'icon-core > candidate order is requested style first, then the brands fallback',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.expect(core.candidateRelPaths('apple', 'solid')).toEqual(['solid/apple.svg', 'brands/apple.svg']);
          ctx.expect(core.candidateRelPaths('github', 'brands')).toEqual(['brands/github.svg']);
        },
      });

      cases.push({
        name: 'icon-core > injects the full root attribute set, each only when absent',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const raw = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0"/></svg>';
          const out = core.injectSvgAttributes(raw);
          ctx.expect(out.includes('width="1em"')).toBeTruthy();
          ctx.expect(out.includes('height="1em"')).toBeTruthy();
          ctx.expect(out.includes('fill="currentColor"')).toBeTruthy();
          ctx.expect(out.includes('aria-hidden="true"')).toBeTruthy();
          ctx.expect(out.includes('focusable="false"')).toBeTruthy();
          ctx.expect(out.includes('overflow="visible"')).toBeTruthy();

          // hand-authored sizing/fill is never overridden
          const sized = core.injectSvgAttributes('<svg width="24" fill="red" viewBox="0 0 1 1"></svg>');
          ctx.expect(sized.includes('width="24"') && !sized.includes('width="1em"')).toBeTruthy();
          ctx.expect(sized.includes('fill="red"') && !sized.includes('fill="currentColor"')).toBeTruthy();

          // non-SVG input passes through untouched
          ctx.expect(core.injectSvgAttributes('not svg')).toBe('not svg');
        },
      });

      cases.push({
        name: 'icon-core > strips every comment from the SVG it prepares',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          // Font Awesome ships its license comment inside every glyph. Injected
          // verbatim, its `-->` TERMINATES any surrounding HTML comment — an icon
          // inside a commented-out block (body.html's parked flash-sale banner)
          // rendered the whole dead block on every page. Attribution lives on in
          // the emitted /assets/icons/ set files, which are copied, not rebuilt.
          const raw = '<svg viewBox="0 0 512 512"><!--! Font Awesome Free 7.3.0 by @fontawesome --><path d="M0 0"/></svg>';
          const out = core.injectSvgAttributes(raw);
          ctx.expect(!out.includes('<!--'), 'no comment survives into the injected markup').toBeTruthy();
          ctx.expect(out.includes('<path d="M0 0"/>'), 'the glyph itself is untouched').toBeTruthy();
        },
      });

      cases.push({
        name: 'icon-core > builds the alias map from icon-families metadata',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const map = core.buildAliasMap({
            'magnifying-glass': { aliases: { names: ['search'] } },
            'address-card': { aliases: { names: ['contact-card', 'vcard'] } },
            rocket: {},
          });
          ctx.expect(map.get('search')).toBe('magnifying-glass');
          ctx.expect(map.get('vcard')).toBe('address-card');
          ctx.expect(map.get('rocket')).toBe(undefined);
          ctx.expect(core.buildAliasMap(null).size).toBe(0);
        },
      });
      return cases;
    })(),
  ],
});

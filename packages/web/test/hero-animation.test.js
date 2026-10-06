/**
 * The hero's custom-animation slot
 * ([#441](https://github.com/Omega-JS-Stack/omega/issues/441), Ian's ruling
 * 2026-08-25).
 *
 * A brand that wants a moving hero visual makes ONE folder —
 * `src/_hero/<name>/{index.html, style.scss, script.js}` — and names it in the
 * hero's frontmatter (`demo: { type: 'custom', name: '<name>' }`). Three lanes
 * have to land for that to be true: the markup resolves through the layer
 * chain, the sheet compiles into the main bundle beside every section.scss, and
 * the script registers on the same DOM-presence init the section JS lane uses.
 *
 * The framework ships `orbit` as the reference animation, in exactly that
 * shape, so the slot is proven by a real entry rather than a fixture — and a
 * consumer folder overriding the name is proven against it.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const sass = require('sass');

const { buildSite, buildWith: sharedBuildWith, miniData, MINI, PKG } = require('./lib/build.js');
const { collectHeroAnimations, HERO_DIR, HERO_FILES } = require('../src/hero-animations.js');
const { sectionsImporter, layeredFileImporter } = require('../src/assets.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'hero-animation-test');

const THEMES = path.join(PKG, 'themes');
const BASE_THEME = path.join(THEMES, 'base');
const REFERENCE = path.join(BASE_THEME, HERO_DIR, 'orbit');

module.exports = defineCases({
  type: 'group',
  description: 'hero-animation',
  tests: [
    {
      name: '#441: the framework ships one reference animation, in the shape a consumer authors',
      run: (ctx) => {
        for (const file of Object.values(HERO_FILES)) {
          ctx.expect(fs.existsSync(path.join(REFERENCE, file)), `themes/base/${HERO_DIR}/orbit/${file} — the slot's three lanes, all present`).toBeTruthy();
        }

        // The accessibility contract: any animation ships its reduced-motion branch
        // in the same change (docs/shared/theming.md).
        const sheet = fs.readFileSync(path.join(REFERENCE, HERO_FILES.scss), 'utf8');
        ctx.expect(sheet, 'the reference animation parks for reduced motion').toMatch(/prefers-reduced-motion: reduce/);
        ctx.expect(sheet, '…by dropping its loops, not by hiding the piece').toMatch(/animation: none/);

        // Token-only: a hero animation re-inks with the brand like every other
        // surface, so it names no colour of its own.
        const declarations = sheet.replace(/\/\/[^\n]*/g, '');
        ctx.expect(!/#[0-9a-fA-F]{3,8}\b/.test(declarations), 'no hardcoded colours — the sheet reads --omega-* tokens').toBeTruthy();
      },
    },

    {
      name: '#441: a named animation renders into the hero\'s custom demo slot',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        // The hero's own showcase roster carries the named-folder variant, so the
        // gallery frame IS the rendered proof.
        const frame = pages.get('/test/sections/marketing/hero/frames/custom-animation');

        ctx.expect(frame, 'the variant renders as a frame page').toBeTruthy();
        ctx.expect(frame, 'it lands in the custom demo slot').toMatch(/<div id="hero-demo-custom"/);
        ctx.expect(frame, 'wrapped in the hook that boots its script.js').toMatch(/data-omega-hero="orbit"/);
        ctx.expect(frame, 'and the folder\'s own markup is what rendered').toMatch(/class="omega-orbit"/);
        ctx.expect(frame, 'the folder\'s icons go through the build\'s inlining pass').toMatch(/<i class="fa-solid fa-globe" data-omega-fa="solid\/globe"><svg/);

        // The other custom lane is untouched: call-site markup still fills the slot.
        const authored = pages.get('/test/sections/marketing/hero/frames/custom-slot');
        ctx.expect(authored, 'an authored `options.content` still renders').toMatch(/id="demo-brand-color"/);
        ctx.expect(!authored.includes('data-omega-hero'), 'and never claims a folder it did not name').toBeTruthy();
      },
    },

    {
      name: '#441: a consumer folder wins the name over the framework\'s own',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-hero-anim-'));
        const consumerDir = path.join(tmp, 'src');
        fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
        fs.mkdirSync(path.join(consumerDir, HERO_DIR, 'orbit'), { recursive: true });
        fs.writeFileSync(
          path.join(consumerDir, HERO_DIR, 'orbit', HERO_FILES.html),
          '<p class="brand-orbit">the brand\'s own orbit</p>\n',
        );
        fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
          '---', 'layout: frontend/core/base', 'permalink: /', '---',
          '{% section "marketing/hero" %}',
          'demo:',
          '  enabled: true',
          '  type: custom',
          '  name: orbit',
          '{% endsection %}',
          '',
        ].join('\n'));

        try {
          const pages = await buildSite(consumerDir, miniData, { environment: 'development' }, 'hero-animation-consumer');
          const home = pages.get('/');

          ctx.expect(home, 'the consumer folder is what rendered').toMatch(/class="brand-orbit"/);
          ctx.expect(!home.includes('class="omega-orbit"'), 'the framework reference stepped aside — first layer wins the whole entry').toBeTruthy();
          ctx.expect(home, 'the boot hook still names the animation').toMatch(/data-omega-hero="orbit"/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#441: the folder\'s style.scss and script.js ride the section asset lanes',
      run: (ctx) => {
        const roots = [MINI, BASE_THEME];
        const collected = collectHeroAnimations(roots);
        const orbit = collected.find((entry) => entry.id === 'orbit');

        ctx.expect(orbit, 'the walk finds the reference animation').toBeTruthy();
        ctx.expect(orbit.kind, 'it reports the kind the boot registry keys on').toBe('hero');
        ctx.expect(orbit.scss, 'the sheet is in the lane').toBe(path.join(REFERENCE, HERO_FILES.scss));
        ctx.expect(orbit.js, 'and so is the script').toBe(path.join(REFERENCE, HERO_FILES.js));

        // The CSS half, proven through the real importer core main.scss uses. From a
        // FILE, like the build does: sass resolves the module's own `file://` @use
        // list through the default filesystem importer, which compileString has none of.
        const entryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-hero-sass-'));
        const entry = path.join(entryDir, 'main.scss');
        fs.writeFileSync(entry, "@use 'omega:sections';\n");
        const compiled = sass.compile(entry, {
          importers: [layeredFileImporter(roots), sectionsImporter(collected)],
          logger: { warn: () => {}, debug: () => {} },
        }).css;
        fs.rmSync(entryDir, { recursive: true, force: true });
        ctx.expect(compiled, 'the animation\'s sheet compiles into the omega:sections lane').toMatch(/\.omega-orbit/);
        ctx.expect(compiled, 'reduced-motion branch and all').toMatch(/prefers-reduced-motion: reduce/);

        // The JS half: the presence init contract, so bootSections can call it.
        const script = fs.readFileSync(path.join(REFERENCE, HERO_FILES.js), 'utf8');
        ctx.expect(script, 'script.js is a per-element init, like a section.js').toMatch(/export default \(el\)/);
      },
    },

    {
      name: '#441: an animation nobody authored fails the build, naming the folder it looked for',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-hero-missing-'));
        const consumerDir = path.join(tmp, 'src');
        fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
        fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
          '---', 'layout: frontend/core/base', 'permalink: /', '---',
          '{% section "marketing/hero" %}',
          'demo:',
          '  enabled: true',
          '  type: custom',
          '  name: nope',
          '{% endsection %}',
          '',
        ].join('\n'));

        try {
          await ctx.expect((() => buildSite(consumerDir, miniData, { environment: 'development' }, 'hero-animation-missing'))()).rejects.toThrow((error) => {
              const parts = [];
              for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
              const message = parts.join(' | ');
              ctx.expect(message, 'the error names the animation').toMatch(/hero_animation "nope"/);
              ctx.expect(message, '…and the file it looked for').toMatch(new RegExp(`${HERO_DIR}/nope/${HERO_FILES.html}`));
              return true;
            });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});

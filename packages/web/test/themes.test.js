/**
 * C3 two-tier theming mechanics.
 *
 * Tier 1 — consumer main.scss over the stock theme: the consumer's entry
 * wins the layered lookup, `@use 'omega:main' with (…)` pulls and CONFIGURES
 * the whole chain below it (the migrated UJM customization pattern), and the
 * consumer's own rules land last so they win the cascade.
 *
 * Tier 2 — consumer-local FULL theme: `<consumer>/themes/<id>` beats the
 * packaged theme for the same id (resolveThemeLayers), its layouts win the
 * farm, and pages it doesn't cover fall through to the base layer.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const sass = require('sass');

const { collectLayered, resolveThemeLayers } = require('../src/layers.js');
const { consumerPaths } = require('../src/consumer.js');
const { resolveAssetThemeLayers } = require('../src/commands/dev.js');
const { buildAssets, firstPaintFontFaces, layeredFileImporter, sectionsImporter } = require('../src/assets.js');
const { checkThemeVocabulary } = require('../src/theme-vocabulary.js');
const { buildWith: sharedBuildWith, miniData, MINI, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'themes-test');

const THEMING = path.join(__dirname, 'fixtures', 'theming');
// Own the css-lane out dir per process — assets.test.js's #182 rule.
const FONTS_OUT = path.join(PKG, '.omega', `themes-test-fonts-out-${process.pid}`);

// ─── The fall-through guard (#98): a theme that reached NEITHER lane warns ───

// The compiled main bundle for a theme root of any provenance (fixture dirs
// included — the shipped chain always sits under it).
function compileMain(themeRoot) {
  const layers = [themeRoot, path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];
  return sass.compile(path.join(PKG, 'core', 'css', 'main.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;
}

// ─── Font preloads (#765): read off the compiled sheet's @font-face rules ──

/**
 * Build ONLY the css half over a real theme chain and hand back the manifest.
 * The preload list is a product of the COMPILED sheet, so the pin runs the
 * lane that compiles it — same shape critical-css.test.js uses.
 * @param {string[]} themeIds - the theme layer chain, active theme first
 * @returns {Promise<object>} the asset manifest
 */
function buildThemeCss(themeRoots, name, overrides = {}) {
  return buildAssets({
    layers: [...themeRoots, path.join(PKG, 'core')],
    themeRoots,
    sectionRoots: themeRoots,
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    // One dir per build, like a real lane: every build starts from an empty
    // out dir, and the preload list names the faces THIS build wrote.
    outDir: path.join(FONTS_OUT, name),
    clientEntry: path.join(PKG, '..', 'client', 'src', 'index.js'),
    only: 'css',
    ...overrides,
  });
}

/** The packaged theme chain for a theme id. */
const packagedChain = (id) => [path.join(PKG, 'themes', id), path.join(PKG, 'themes', 'base')];

module.exports = defineCases({
  type: 'group',
  description: 'themes',
  cleanup: () => {
    fs.rmSync(FONTS_OUT, { recursive: true, force: true });
  },
  tests: [
    // ─── resolveThemeLayers ──────────────────────────────────────────────────────

    {
      name: 'resolveThemeLayers: consumer-local theme wins; packaged is the fallback; base always present',
      run: (ctx) => {
        const themesDir = path.join(PKG, 'themes');

        // mini-site ships themes/toy → consumer-local dir wins for 'toy'
        const local = resolveThemeLayers({ activeTheme: 'toy', consumerDir: MINI, themesDir });
        ctx.expect(local).toEqual([
          path.join(MINI, 'themes', 'toy'),
          path.join(themesDir, 'base'),
        ]);

        // no consumer-local dir for 'newsflash' → packaged theme
        const packaged = resolveThemeLayers({ activeTheme: 'newsflash', consumerDir: MINI, themesDir });
        ctx.expect(packaged).toEqual([
          path.join(themesDir, 'newsflash'),
          path.join(themesDir, 'base'),
        ]);

        // classy is a skin like the others (#177): it rides over base too
        ctx.expect(resolveThemeLayers({ activeTheme: 'classy', consumerDir: MINI, themesDir })).toEqual([path.join(themesDir, 'classy'), path.join(themesDir, 'base')]);
        ctx.expect(resolveThemeLayers({ themesDir })).toEqual([path.join(themesDir, 'classy'), path.join(themesDir, 'base')]);
      },
    },

    {
      name: 'the dev asset lane resolves the consumer-local theme the engine renders (#137)',
      run: (ctx) => {
        // A brand's own theme lives at src/themes/<id> — the engine, the production
        // build, and customize all probe the Eleventy INPUT dir. The dev asset lane
        // must probe the same place, or the theme's scss/js never enters the bundle
        // and its dir never enters the asset watcher.
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-assets-')));
        const themeDir = path.join(root, 'src', 'themes', 'toy-theme');
        fs.mkdirSync(path.join(themeDir, 'css'), { recursive: true });
        fs.writeFileSync(path.join(themeDir, 'css', 'main.scss'), '.toy { color: red; }');

        try {
          const layers = resolveAssetThemeLayers(consumerPaths(root), 'toy-theme');

          ctx.expect(layers).toEqual([themeDir, path.join(PKG, 'themes', 'base')]);
          // The consequence: the theme's stylesheet is what the css lane compiles.
          ctx.expect(collectLayered(layers.map((layer) => path.join(layer, 'css')), /^main\.scss$/).get('main.scss'), 'the consumer-local theme wins the asset lane\'s main.scss lookup').toBe(path.join(themeDir, 'css', 'main.scss'));
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    // ─── Tier 1: consumer main.scss over the stock chain ─────────────────────────

    {
      name: 'tier 1: consumer main.scss pulls, configures, and overrides the chain via omega:main',
      run: (ctx) => {
        const consumerRoot = path.join(THEMING, 'consumer');
        const layers = [consumerRoot, path.join(THEMING, 'mini-theme'), path.join(PKG, 'core')];

        const warnings = [];
        const css = sass.compile(path.join(consumerRoot, 'css', 'main.scss'), {
          importers: [layeredFileImporter(layers), sectionsImporter([])],
          loadPaths: layers,
          quietDeps: true,
          silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        }).css;

        ctx.expect(css.includes('--omega-ground'), 'core token sheet came through the chain').toBeTruthy();
        ctx.expect(css.includes('--mini-theme-marker'), 'theme layer resolved via omega:theme').toBeTruthy();
        ctx.expect(css.includes('--mini-color: blue'), '`with (…)` configured the theme variable through core\'s @forward').toBeTruthy();
        ctx.expect(css.includes('--tier1-marker'), 'consumer rules present').toBeTruthy();
        ctx.expect(css.indexOf('--tier1-marker') > css.indexOf('--omega-ground'), 'consumer rules land AFTER the chain so they win the cascade').toBeTruthy();
        ctx.expect(warnings, 'tier-1 compile stays warning-free').toEqual([]);
      },
    },

    // ─── The inheritance hatch (cp190): partial theme @forwards omega:theme ─────

    {
      name: 'inheritance hatch: a partial theme @forwards omega:theme and inherits the classy chain (cp190)',
      run: (ctx) => {
        const partialRoot = path.join(THEMING, 'partial-theme');
        const layers = [partialRoot, path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];

        const css = sass.compile(path.join(partialRoot, '_theme.scss'), {
          importers: [layeredFileImporter(layers), sectionsImporter([])],
          loadPaths: layers,
          quietDeps: true,
          silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
          logger: { warn: () => {}, debug: () => {} },
        }).css;

        // The self-skip landed the @forward on base, whose bridge emits classy
        ctx.expect(css.includes('.omega-auth'), 'classy auth vocabulary inherited').toBeTruthy();
        ctx.expect(css.includes('.omega-statgrid'), 'classy app vocabulary inherited').toBeTruthy();
        ctx.expect(css.includes('--bs-body-bg: var(--omega-ground)'), 'classy token bridge inherited').toBeTruthy();

        // The partial theme's own rules land AFTER the chain so they win ties
        ctx.expect(css.includes('--partial-marker'), 'partial theme rules present').toBeTruthy();
        ctx.expect(css.indexOf('--partial-marker') > css.lastIndexOf('.omega-statgrid'), 'partial rules land after the inherited chain').toBeTruthy();
      },
    },

    // ─── Per-component knobs (#253): the hatch's `with (…)` re-shapes classy ────

    {
      name: 'hatch knobs: a partial theme re-values classy\'s per-component type + shape through `with (…)` (#253)',
      run: (ctx) => {
        // A brand with its own shape/type identity configures classy ONLY through
        // the hatch. Two of the surfaces below are what #253 actually unlocked:
        // classy's OWN css HARDCODED them (`_typography.scss` heading font,
        // `_forms.scss` input-group radii), so no `with (…)` value could reach them
        // until they became !default slots those rules read. The other seven already
        // flowed through Bootstrap's own !defaults before #253 and stay as
        // REGRESSION PINS — classy declaring + forwarding its own slots must not
        // sever the path they were already riding.
        const knobsRoot = path.join(THEMING, 'knobs-theme');
        const layers = [knobsRoot, path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];

        const css = sass.compile(path.join(knobsRoot, '_theme.scss'), {
          importers: [layeredFileImporter(layers), sectionsImporter([])],
          loadPaths: layers,
          quietDeps: true,
          silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
          logger: { warn: () => {}, debug: () => {} },
        }).css;

        // THE FIX (1/2) — type: classy's OWN heading rule (the one that lands after
        // Bootstrap's) reads the knob, so the brand face survives to the compiled
        // output. Before #253 this rule said `var(--omega-font-display)` outright.
        const headings = css.match(/\nh1, \.h1,[\s\S]*?\{([\s\S]*?)\}/);
        ctx.expect(headings, 'classy\'s heading rule is present').toBeTruthy();
        ctx.expect(headings[1], '$headings-font-family reached classy\'s heading rule').toMatch(/font-family: "Knobtest Display";/);

        // THE FIX (2/2) — shape: the input-group composition reads
        // $input-border-radius, so a re-shaped field stays consistent with the
        // standalone .form-control. Before #253 it read the global $border-radius.
        const inputGroup = css.match(/\n\.input-group > \.form-control,\n\.input-group > \.form-control\.is-invalid,[\s\S]*?\{([\s\S]*?)\}/);
        ctx.expect(inputGroup, 'classy\'s input-group rule is present').toBeTruthy();
        ctx.expect(inputGroup[1], '$input-border-radius reached classy\'s input-group rule').toMatch(/border-radius: 4\.0404px;/);

        // PINS — the seven that already worked: each reaches a Bootstrap component
        // variable, one surface each, none of them moving the global $border-radius
        // family.
        for (const [property, value] of [
          ['--bs-btn-border-radius', '3.0404px'],
          ['--bs-badge-border-radius', '7.0707px'],
          ['--bs-toast-border-radius', '6.0606px'],
          ['--bs-modal-border-radius', '5.0505px'],
        ]) {
          ctx.expect(css.includes(`${property}: ${value};`), `${property} carries the override`).toBeTruthy();
        }
        ctx.expect(css.includes('border-radius: 3.0202px'), '$btn-border-radius-sm reached the small button').toBeTruthy();
        ctx.expect(css.includes('border-radius: 4.0606px'), '$input-border-radius-lg reached the large field').toBeTruthy();

        // Untouched knobs keep classy's shape (10px buttons/inputs are the default).
        ctx.expect(css.includes('--bs-border-radius: 0.625rem'), 'the global radius family is unmoved').toBeTruthy();
      },
    },

    {
      name: 'stock classy: the two surfaces #253 re-slotted still emit classy\'s own look unconfigured',
      run: (ctx) => {
        // The knobs fixture can only prove an override ARRIVES. Nobody configures
        // stock classy, so the same two rules are where a #253-style re-slot silently
        // changes what every unconfigured brand ships — pin their stock output.
        const layers = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];
        const css = sass.compile(path.join(PKG, 'themes', 'classy', '_theme.scss'), {
          importers: [layeredFileImporter(layers), sectionsImporter([])],
          loadPaths: layers,
          quietDeps: true,
          silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
          logger: { warn: () => {}, debug: () => {} },
        }).css;

        // Type: the heading face is still the runtime token, so data-omega-type
        // presets and a plain-CSS re-point keep steering headings with no recompile.
        const headings = css.match(/\nh1, \.h1,[\s\S]*?\{([\s\S]*?)\}/);
        ctx.expect(headings, 'classy\'s heading rule is present').toBeTruthy();
        ctx.expect(headings[1], 'stock headings still ride --omega-font-display').toMatch(/font-family: var\(--omega-font-display\);/);

        // Shape: the input-group still rides the --bs- radius ramp, which classy
        // values at 10px — the standalone .form-control's radius, unchanged.
        const inputGroup = css.match(/\n\.input-group > \.form-control,\n\.input-group > \.form-control\.is-invalid,[\s\S]*?\{([\s\S]*?)\}/);
        ctx.expect(inputGroup, 'classy\'s input-group rule is present').toBeTruthy();
        ctx.expect(inputGroup[1], 'stock input-group rides the --bs- radius ramp').toMatch(/border-radius: var\(--bs-border-radius\);/);
        ctx.expect(css.includes('--bs-border-radius: 0.625rem'), 'and that ramp still computes to classy\'s 10px').toBeTruthy();
      },
    },

    {
      name: 'fall-through guard: a hatchless partial theme warns and names the inheritance hatch (#98)',
      run: (ctx) => {
        const themeRoot = path.join(THEMING, 'hatchless-theme');
        const warnings = [];
        const result = checkThemeVocabulary({
          css: compileMain(themeRoot),
          themeRoots: [themeRoot, path.join(PKG, 'themes', 'base')],
          warn: (message) => warnings.push(message),
        });

        ctx.expect(warnings.length, 'exactly one warning block per build').toBe(1);
        ctx.expect(result).toEqual({
          theme: 'hatchless-theme',
          lane: 'hatch',
          missing: ['.omega-auth', '.omega-statgrid', '.omega-footer'],
        });

        const block = warnings[0];
        ctx.expect(block.includes('theme "hatchless-theme"'), 'names the theme').toBeTruthy();
        ctx.expect(block.includes('.omega-auth (pages/auth'), 'names the missing sentinel and its partial').toBeTruthy();
        ctx.expect(block.includes('inheritance hatch'), 'names the missing piece').toBeTruthy();
        ctx.expect(block.includes("@forward 'omega:theme';"), 'carries the exact fix line').toBeTruthy();
        ctx.expect(block.includes('themes/hatchless-theme/_theme.scss'), 'names the file to edit').toBeTruthy();
        ctx.expect(block.includes('docs/shared/theming.md'), 'points at the contract').toBeTruthy();
      },
    },

    {
      name: 'fall-through guard: a sibling theme with its own Bootstrap is sent to the floor imports (#98)',
      run: (ctx) => {
        const themeRoot = path.join(THEMING, 'floorless-theme');
        const warnings = [];
        const result = checkThemeVocabulary({
          css: compileMain(themeRoot),
          themeRoots: [themeRoot, path.join(PKG, 'themes', 'base')],
          warn: (message) => warnings.push(message),
        });

        ctx.expect(warnings.length, 'exactly one warning block per build').toBe(1);
        ctx.expect(result.lane, 'its own Bootstrap rules the hatch out').toBe('floor');
        ctx.expect(warnings[0].includes('vocabulary floor'), 'names the missing piece').toBeTruthy();
        ctx.expect(warnings[0].includes("@import '../classy/css/pages/auth';")
          && warnings[0].includes("@import '../classy/css/app/panels';")
          && warnings[0].includes("@import '../classy/css/layout/footer';"), 'carries the exact floor import lines').toBeTruthy();
        ctx.expect(!warnings[0].includes("@forward 'omega:theme'"), 'never suggests two Bootstraps').toBeTruthy();
      },
    },

    {
      name: 'fall-through guard: every bundled theme is silent (#98)',
      run: (ctx) => {
        const themesDir = path.join(PKG, 'themes');
        for (const id of fs.readdirSync(themesDir).filter((name) => !name.startsWith('_') && name !== 'bootstrap')) {
          const themeRoots = resolveThemeLayers({ activeTheme: id, themesDir });
          const warnings = [];
          const result = checkThemeVocabulary({
            css: compileMain(path.join(themesDir, id)),
            themeRoots,
            warn: (message) => warnings.push(message),
          });
          ctx.expect(result, `${id} reaches the fall-through vocabulary`).toBe(null);
          ctx.expect(warnings, `${id} builds silent`).toEqual([]);
        }
      },
    },

    {
      name: 'fall-through guard: the asset lane fires it on the real css build (#98)',
      run: async (ctx) => {
        const themeRoot = path.join(THEMING, 'hatchless-theme');
        const themeRoots = [themeRoot, path.join(PKG, 'themes', 'base')];
        const warnings = [];
        await buildAssets({
          layers: [...themeRoots, path.join(PKG, 'core')],
          themeRoots,
          sectionRoots: themeRoots,
          themesDir: path.join(PKG, 'themes'),
          coreDir: path.join(PKG, 'core'),
          outDir: path.join(PKG, '.omega', 'themes-test-guard-out'),
          only: 'css',
          warn: (message) => warnings.push(message),
        });

        ctx.expect(warnings.length, 'the css lane emitted the guard block once').toBe(1);
        ctx.expect(warnings[0].includes('theme "hatchless-theme"'), 'the wired warning names the theme').toBeTruthy();
      },
    },

    // ─── Tier 2: consumer-local full theme through the engine ────────────────────

    {
      name: 'tier 2: consumer-local theme layouts win the farm; uncovered pages fall through to base',
      run: async (ctx) => {
        const pages = await buildWith(miniData, { activeTheme: 'toy' });

        const pricing = pages.get('/pricing');
        ctx.expect(pricing.includes('TOY THEME PRICING via consumer-local theme'), 'toy layout rendered /pricing').toBeTruthy();
        ctx.expect(!pricing.includes('id="pricing-promo-banner"'), 'classy pricing chrome fully replaced').toBeTruthy();

        const about = pages.get('/about');
        ctx.expect(about && about.length > 0, 'pages the toy theme does not cover still render').toBeTruthy();
        ctx.expect(about.includes('<html'), 'fallback pages render through the base chain').toBeTruthy();
      },
    },

    // ─── The tier-2 floors (#773): what a consumer theme may leave out ──────────
    //
    // A tier-2 theme wins its id WHOLE, so every lane that used to reach the
    // packaged theme by being the packaged theme has to keep working when a
    // consumer dir stands in its place. Three did not, and the brand-shape
    // corpus's shape-theme-override cell is what found them.

    {
      name: 'tier 2: a consumer-local theme\'s own _includes rung wins, and is machinery not content (#773)',
      run: async (ctx) => {
        // Eleventy walks the input dir, and a tier-2 theme lives inside it. Its
        // _layouts/_sections/_components were ignored; its _includes was not — so a
        // theme shipping an include override failed the whole build on a duplicate
        // permalink (every machinery file writing to `dist/.html`).
        const pages = await buildWith(miniData, { activeTheme: 'toy' }, 'themes-test-includes');

        const pricing = pages.get('/pricing');
        ctx.expect(pricing, 'the build produced /pricing at all — a machinery file emitted as content kills it').toBeTruthy();
        ctx.expect(pricing.includes('TOY THEME INCLUDE via consumer-local theme'), 'the theme rung of the include lane never won: core/pricing/price-per-unit.html came from core').toBeTruthy();

        const machinery = [...pages.keys()].filter((url) => url.includes('themes/toy'));
        ctx.expect(machinery, 'the theme\'s own machinery was emitted as pages').toEqual([]);
      },
    },

    {
      name: 'tier 2: a theme with no _theme.js rides base\'s floor (#773)',
      run: async (ctx) => {
        // core/js/main.js dynamically imports `__theme__/_theme.js`; the alias walks
        // the theme roots and falls back to the FIRST one when nobody ships it. Base
        // had no js twin of its _theme.scss bridge, so an empty consumer theme took
        // the fallback and the bundle died on an ENOENT for a file it never claimed.
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-theme-floor-')));
        const themeDir = path.join(root, 'themes', 'silent');
        fs.mkdirSync(themeDir, { recursive: true });

        try {
          const manifest = await buildThemeCss(
            [themeDir, path.join(PKG, 'themes', 'base')],
            'theme-js-floor',
            { only: undefined },
          );
          ctx.expect(manifest.js && manifest.js.main, 'the js bundle never got written').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'tier 2: a shadowing theme with no _theme.js inherits the packaged skin\'s, not base\'s floor (#773)',
      run: async (ctx) => {
        // The scss hatch and the js entry have to agree: a consumer theme standing
        // in for `classy` and shipping neither file inherits BOTH from the skin it
        // shadows. Resolving straight to base's floor instead would silently drop
        // Bootstrap-on-window and the skin's boots — a working build with a dead UI.
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-theme-js-twin-')));
        const themeDir = path.join(root, 'themes', 'classy'); // the id it SHADOWS
        fs.mkdirSync(themeDir, { recursive: true });

        try {
          const manifest = await buildThemeCss(
            [themeDir, path.join(PKG, 'themes', 'base')],
            'shadowed-theme-js',
            { only: undefined },
          );

          // The theme entry is a dynamic import, so it rides its own code-split
          // chunk — the whole js output is the haystack, not just main.
          const jsDir = path.join(FONTS_OUT, 'shadowed-theme-js', 'assets', 'js');
          const walk = (dir, out = []) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const file = path.join(dir, entry.name);
              if (entry.isDirectory()) walk(file, out);
              else if (entry.name.endsWith('.js')) out.push(fs.readFileSync(file, 'utf8'));
            }
            return out;
          };
          const bundled = walk(jsDir).join('\n');

          // `#hero-demo-form` is a string LITERAL in themes/classy/js/hero-demo-form.js
          // — a file ONLY classy's _theme.js imports. A literal survives minification,
          // which an identifier does not, so this names the packaged skin's theme
          // module rather than base's empty floor.
          ctx.expect(bundled.includes('#hero-demo-form'), "the shadowed skin's _theme.js never reached the bundle — the walk fell through to base's floor").toBeTruthy();
          ctx.expect(manifest.js && manifest.js.main, 'the js bundle never got written').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'every packaged theme is a module: _theme.js default-exports a function taking { omega }, and imports no host (#945)',
      run: (ctx) => {
        // The host (web's main.js, the extension's page contexts, the desktop
        // renderer) calls the theme with ITS instance, so theme JS is host-neutral:
        // a theme importing a host's instance module breaks every other host (the
        // extension vendors this tree and its vendor guard refuses @omega.js/web).
        // Only a lib with no entry would import a runtime, and themes ship none.
        const themesDir = path.join(PKG, 'themes');
        const themes = fs.readdirSync(themesDir).filter((id) => fs.existsSync(path.join(themesDir, id, '_theme.js')));
        ctx.expect(themes.includes('classy') && themes.includes('base'), `the theme list read wrong: ${themes.join(', ')}`).toBeTruthy();

        const walk = (dir, out = []) => {
          if (!fs.existsSync(dir)) return out;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file, out);
            else if (entry.name.endsWith('.js')) out.push(file);
          }
          return out;
        };

        for (const id of themes) {
          const entry = path.join(themesDir, id, '_theme.js');
          ctx.expect(fs.readFileSync(entry, 'utf8'), `${id}/_theme.js does not default-export a function taking { omega }`).toMatch(/^export default async function\s*\w*\s*\(\{\s*omega\b/m);

          // Every JS file the theme ships, sections included: the extension and
          // desktop vendor the whole tree, and a section init receives { omega } too
          for (const file of walk(path.join(themesDir, id))) {
            ctx.expect(!/['"]@omega\.js\/(web|desktop|extension)(\/[^'"]*)?['"]/.test(fs.readFileSync(file, 'utf8')), `${path.relative(themesDir, file)} imports a host package; take omega from its entry's { omega } argument`).toBeTruthy();
          }
        }
      },
    },

    {
      name: 'tier 2: a shadowing theme inherits the packaged theme\'s font FILES, not just its faces (#773)',
      run: async (ctx) => {
        // `@forward 'omega:theme'` hands a consumer theme the packaged skin's
        // @font-face rules — whose urls point into the very dir the consumer theme
        // replaced. The files have to travel with the rules, or every one 404s and
        // the preload lane drops them all as unfetchable.
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-theme-fonts-')));
        const themeDir = path.join(root, 'themes', 'classy'); // the id it SHADOWS
        fs.mkdirSync(themeDir, { recursive: true });
        fs.writeFileSync(path.join(themeDir, '_theme.scss'), "@forward 'omega:theme';\n");

        try {
          const manifest = await buildThemeCss(
            [themeDir, path.join(PKG, 'themes', 'base')],
            'shadowed-fonts',
          );

          const fontsDir = path.join(FONTS_OUT, 'shadowed-fonts', 'assets', 'fonts');
          const copied = fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir) : [];
          ctx.expect(copied.some((name) => name.startsWith('inter-')), `the shadowed theme's own faces never reached dist (got: ${copied.join(', ') || 'nothing'})`).toBeTruthy();
          ctx.expect(manifest.fontPreloads.length > 0, 'every inherited face was dropped as unfetchable, so the head preloads nothing').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'font preloads: classy\'s four latin faces, picked off its @font-face rules (#765)',
      run: async (ctx) => {
        const manifest = await buildThemeCss(packagedChain('classy'), 'classy');

        // Exactly the set the name rule produced before #765 — now proven from what
        // the CSS declares: the latin subsets of both vendored families, both styles
        // (#467: every display headline renders its accent as an <em>).
        ctx.expect(manifest.fontPreloads).toEqual([
          '/assets/fonts/inter-italic-latin.woff2',
          '/assets/fonts/inter-normal-latin.woff2',
          '/assets/fonts/newsreader-italic-latin.woff2',
          '/assets/fonts/newsreader-normal-latin.woff2',
        ]);
      },
    },

    {
      name: 'font preloads: newsflash gets its own four by the same rule (#765)',
      run: async (ctx) => {
        const manifest = await buildThemeCss(packagedChain('newsflash'), 'newsflash');

        ctx.expect(manifest.fontPreloads).toEqual([
          '/assets/fonts/fraunces-italic-latin.woff2',
          '/assets/fonts/fraunces-normal-latin.woff2',
          '/assets/fonts/schibsted-grotesk-italic-latin.woff2',
          '/assets/fonts/schibsted-grotesk-normal-latin.woff2',
        ]);
      },
    },

    {
      name: 'font preloads: a theme that vendors no faces preloads none (#177)',
      run: async (ctx) => {
        // The inheritance hatch hands a partial theme the default skin's @font-face
        // rules WITHOUT its font files (fonts are skin assets, #177), so the rule
        // alone would name four files this build never wrote. The list is kept to
        // the faces that ship.
        const manifest = await buildThemeCss([path.join(MINI, 'themes', 'toy'), path.join(PKG, 'themes', 'base')], 'toy');

        ctx.expect(manifest.fontPreloads, 'no faces shipped, so no preloads').toEqual([]);
      },
    },

    {
      name: 'font preloads: a face hosted elsewhere rides through; a missing local file does not',
      run: async (ctx) => {
        // The shipped-face filter is about THIS build's own files: a root-relative
        // face names something the build writes, so a preload for one it did not
        // write is a guaranteed 404. An absolute (or protocol-relative) src belongs
        // to another origin — the browser can fetch it, and the head's loop already
        // emits the crossorigin the spec asks for — so it passes through untouched.
        const layer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-font-src-')));
        fs.mkdirSync(path.join(layer, 'css'), { recursive: true });
        fs.mkdirSync(path.join(layer, 'fonts'), { recursive: true });
        fs.writeFileSync(path.join(layer, 'fonts', 'shipped.woff2'), 'face');
        fs.writeFileSync(path.join(layer, 'css', 'main.scss'), [
          '@font-face { font-family: Shipped; src: url(/assets/fonts/shipped.woff2); unicode-range: U+0000-00FF; }',
          '@font-face { font-family: Gone; src: url(/assets/fonts/gone.woff2); unicode-range: U+0000-00FF; }',
          '@font-face { font-family: Cdn; src: url(https://cdn.example.com/brand.woff2); unicode-range: U+0000-00FF; }',
          '@font-face { font-family: CdnExt; src: url(//cdn.example.com/brand-ext.woff2); unicode-range: U+0100-02BA; }',
          '@font-face { font-family: Wandering; src: url(../fonts/wandering.woff2); unicode-range: U+0000-00FF; }',
        ].join('\n'));

        try {
          const warnings = [];
          const manifest = await buildThemeCss([layer], 'font-src', { warn: (message) => warnings.push(message) });

          ctx.expect(manifest.fontPreloads, 'the shipped face and the CDN one; the file that was never written is dropped').toEqual([
            '/assets/fonts/shipped.woff2',
            'https://cdn.example.com/brand.woff2',
          ]);

          // A page-relative src resolves against the PAGE, so /blog/post/ would ask
          // for the wrong path — it is skipped, and loudly, because a silent skip is
          // the failure mode #765 was filed about.
          ctx.expect(!manifest.fontPreloads.some((url) => url.includes('wandering')), 'the relative src is not preloaded').toBeTruthy();
          const wandering = warnings.filter((message) => message.includes('wandering.woff2'));
          ctx.expect(wandering.length, 'exactly one warning for the relative src').toBe(1);
          ctx.expect(wandering[0].includes('Wandering'), 'the warning names the face').toBeTruthy();
          ctx.expect(wandering[0].includes('../fonts/wandering.woff2'), 'and the url it could not mount').toBeTruthy();
        } finally {
          fs.rmSync(layer, { recursive: true, force: true });
        }
      },
    },

    // The rule itself, on hand-written sheets — the shapes no packaged theme has
    // yet, which is exactly why the name rule failed them (#765).
    {
      name: 'the rule: no unicode-range means every glyph, so the face is a first-paint face',
      run: (ctx) => {
        const css = '@font-face{font-family:Brand;src:url(/assets/fonts/brand-variable.woff2) format("woff2")}';

        ctx.expect(firstPaintFontFaces(css)).toEqual(['/assets/fonts/brand-variable.woff2']);
      },
    },

    {
      name: 'the rule: a latin face is picked by its RANGE, whatever its file is named',
      run: (ctx) => {
        const css = [
          '@font-face{font-family:Brand;src:url("/assets/fonts/DisplayRegular.woff2");unicode-range:U+0000-00FF,U+0131,U+2000-206F}',
          "@font-face{font-family:Brand;src:url('/assets/fonts/DisplayRegular-x.woff2');unicode-range:U+0100-02BA,U+2C60-2C7F}",
        ].join('');

        ctx.expect(firstPaintFontFaces(css), 'the latin subset rides on its range; the latin-ext one stays out whatever it is called').toEqual(['/assets/fonts/DisplayRegular.woff2']);
      },
    },

    {
      name: 'the rule: wildcard ranges expand to their lowest codepoint',
      run: (ctx) => {
        const latin = '@font-face{src:url(/assets/fonts/a.woff2);unicode-range:U+00??}';
        const ext = '@font-face{src:url(/assets/fonts/b.woff2);unicode-range:U+01??}';

        ctx.expect(firstPaintFontFaces(latin), 'U+00?? is U+0000-00FF').toEqual(['/assets/fonts/a.woff2']);
        ctx.expect(firstPaintFontFaces(ext), 'U+01?? starts above basic latin').toEqual([]);
      },
    },

    {
      name: 'the rule: woff2 only, deduped and sorted',
      run: (ctx) => {
        const css = [
          '@font-face{src:url(/assets/fonts/b.woff2) format("woff2"),url(/assets/fonts/b.woff) format("woff")}',
          '@font-face{src:url(/assets/fonts/a.woff2)}',
          '@font-face{src:url(/assets/fonts/b.woff2);unicode-range:U+0-7F}',
          '@font-face{font-display:auto}',
        ].join('');

        ctx.expect(firstPaintFontFaces(css), 'one entry per URL, sorted — the emitted HTML must be deterministic').toEqual(['/assets/fonts/a.woff2', '/assets/fonts/b.woff2']);
      },
    },

    {
      name: 'the rule: a data: URI does not end the src list',
      run: (ctx) => {
        // `data:font/woff2;base64,…` carries a semicolon of its own — reading the
        // descriptor up to the first `;` swallowed every later source in the face.
        const css = [
          '@font-face{font-family:Brand;',
          'src:url(data:font/woff2;base64,d09GMgABAAAA) format("woff2"),url(/assets/fonts/brand.woff2) format("woff2");',
          'unicode-range:U+0000-00FF}',
        ].join('');

        ctx.expect(firstPaintFontFaces(css), 'the real file is found past the inline one, which is no fetch to preload').toEqual(['/assets/fonts/brand.woff2']);
      },
    },

    {
      name: 'the rule: a sheet with no @font-face at all preloads nothing',
      run: (ctx) => {
        ctx.expect(firstPaintFontFaces('.omega-nav{color:red}')).toEqual([]);
      },
    },

    {
      name: 'the head renders one preload link per manifest entry',
      run: async (ctx) => {
        const pages = await buildWith(miniData, {}, 'font-preloads-head');
        const home = pages.get('/');

        ctx.expect(home.includes('<link rel="preload" href="/assets/fonts/preload-TEST.woff2" as="font" type="font/woff2" crossorigin/>'), 'the head reads assetManifest.fontPreloads and emits the crossorigin font preload').toBeTruthy();
      },
    },

    // ─── App panels: the statgrid reflows to its CONTAINER (#69) ────────────────

    {
      name: 'statgrid: columns come from the container, never the viewport (#69)',
      run: (ctx) => {
        const warnings = [];
        const css = sass.compile(path.join(PKG, 'themes', 'classy', 'css', 'app', '_panels.scss'), {
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        }).css;

        ctx.expect(warnings, 'the app panel floor compiles clean').toEqual([]);

        // The whole partial is viewport-free: nested in a half-width card, the
        // statgrid reflows off ITS OWN width (the #69 consumer defect).
        ctx.expect(!css.includes('@media'), 'no viewport media query in the app panel vocabulary').toBeTruthy();

        const tracks = css.match(/grid-template-columns:[^;]+;/g) || [];
        ctx.expect(tracks.length, 'one track definition, no breakpoint variant').toBe(1);
        ctx.expect(tracks[0].includes('auto-fit'), 'intrinsic sizing fits as many cells as the container holds').toBeTruthy();
        ctx.expect(tracks[0].includes('var(--omega-statgrid-cols'), 'the --omega-statgrid-cols knob still caps the column count').toBeTruthy();

        // Hairlines can't count columns anymore (the reflow decides how many land
        // per row), so cells draw their own rules and the card clips the outer ones.
        ctx.expect(!css.includes('nth-child'), 'no column-count-dependent divider selectors').toBeTruthy();
        ctx.expect(css.includes('overflow: hidden'), 'the card still clips to its rounded frame').toBeTruthy();
      },
    },

    // ─── Section rhythm: nav clearance rides first-of-TYPE ──────────────────────

    {
      name: 'the first section takes nav clearance by TYPE, so a preceding div cannot steal it (#44)',
      run: (ctx) => {
        const warnings = [];
        const css = sass.compile(path.join(PKG, 'themes', 'classy', 'css', 'layout', '_general.scss'), {
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        }).css;

        ctx.expect(warnings, 'the layout floor compiles clean').toEqual([]);

        // /pricing opens with the promo-banner <div> before its hero, and a blog
        // post with the read-progress bar — under :first-child neither hero
        // matched, so those pages started ~5rem tighter than /about. (#764 took the
        // page JS off this element entirely: the banner pushes the nav alone, and
        // the stylesheet holds whatever room it needs.)
        ctx.expect(css, 'the hero is the first section OF ITS TYPE, not the first child').toMatch(/main > section:first-of-type/);
        ctx.expect(css, 'a blog post opens with an <article> and clears the nav too').toMatch(/main > article:first-of-type/);
        ctx.expect(!/main > (section|article):first-child/.test(css), 'no first-child clearance left to lose to a leading div').toBeTruthy();

        // Both the base and the ≥992px step carry the clearance.
        ctx.expect((css.match(/main > section:first-of-type/g) || []).length, 'clearance set at both breakpoints').toBe(2);
      },
    },

    {
      name: "a blog post hands its nav clearance to the dot band, so the dots open the page like every other hero (#44)",
      run: (ctx) => {
        const css = sass.compile(path.join(PKG, 'themes', 'classy', 'css', 'layout', '_general.scss'), {
          logger: { warn: () => {}, debug: () => {} },
        }).css;

        // Ian's screenshot ruling (2026-07-31): held by the <article>, the band
        // started 10rem down and the dots read detached from the nav.
        const band = 'main > article:first-of-type:has(> .omega-dotgrid:first-child)';
        ctx.expect(css.includes(`${band} {\n  padding-top: 0;`), 'the article gives up the clearance').toBeTruthy();
        ctx.expect(css.includes(`${band} > .omega-dotgrid:first-child`), 'the band takes it instead').toBeTruthy();

        // Same numbers as every other opener, at both breakpoints (one mixin).
        const openerClearance = css.match(/padding-top: 10rem;/g) || []; // the breakout utility's !important twin is a different rule
        const openerClearanceLg = css.match(/padding-top: 12rem;/g) || [];
        ctx.expect(openerClearance.length, 'the section opener and the post band clear the nav by the same 10rem').toBe(2);
        ctx.expect(openerClearanceLg.length, 'and by the same 12rem at ≥992px').toBe(2);
      },
    },

    {
      name: 'a blog post wears the dotfield behind its masthead only, never behind the prose (#44)',
      run: (ctx) => {
        const post = fs.readFileSync(path.join(PKG, 'themes', 'base', '_layouts', 'frontend', 'pages', 'blog', 'post.html'), 'utf8');

        // The read surface stays still: the <article> itself carries no dot grid
        // (it wraps the prose), and the ONE dotfield band closes before the
        // content column opens.
        ctx.expect(post, 'the post still opens with the <article> the section rhythm names').toMatch(/<article\{% unless/);
        ctx.expect(!/<article[^>]*omega-dotgrid/.test(post), 'no dot grid on the article — dots behind body text is the thing we fixed').toBeTruthy();

        const bands = post.match(/data-omega-dotfield[ >]/g) || [];
        ctx.expect(bands.length, 'exactly one dotfield band on a post').toBe(1);
        ctx.expect(post, 'the band carries the same contract as every other hero').toMatch(/<div class="omega-dotgrid" data-omega-dotfield>/);
        ctx.expect(post.indexOf('<div class="omega-dotgrid" data-omega-dotfield>') < post.indexOf('blog-post-content'), 'the band sits above the prose column').toBeTruthy();
      },
    },
  ],
});

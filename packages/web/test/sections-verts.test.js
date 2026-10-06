/**
 * The verts/unit section (docs/web/ads-system.md phase 2) — the base-layer
 * fallback-ladder vert band. Pins: context-free markup (host element + data
 * attrs from args, the standard @hide auth binding), neutral mechanical
 * defaults, §7 asset-lane registration (section.js in the main bundle,
 * section.scss on the omega:sections sheet), library resolution, and the
 * source guards that pin the legacy vert.js lane RETIRED (spec sequencing
 * step 5 — the section + shared client verts module are the one implementation).
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { Liquid } = require('liquidjs');

const { registerSectionTags, collectSectionAssets, buildSectionLibrary } = require('../src/sections.js');

const PKG = path.resolve(__dirname, '..');
const BASE = path.join(PKG, 'themes', 'base');
const NEWSFLASH = path.join(PKG, 'themes', 'newsflash');

/** Fresh engine over the real base layer with a captured warn sink. */
function makeEngine(baseDirs = [BASE]) {
  const warnings = [];
  const engine = new Liquid();
  registerSectionTags(engine, { baseDirs, warn: (message) => warnings.push(message) });
  return { engine, warnings };
}

module.exports = defineCases({
  type: 'group',
  description: 'sections-verts',
  tests: [
    // ─── markup (context-free, args only) ───────────────────────────────────────

    {
      name: 'verts/unit: args flow to the data-omega-vert vocabulary on the mount host',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "verts/unit", type: "house", size: "banner", vert_id: "promo1", tags: t, section_class: "my-4" %}',
          { t: ['dev', 'news'] },
        );

        ctx.expect(html.includes('data-omega-section="verts/unit"'), 'presence-init root').toBeTruthy();
        ctx.expect(html.includes('data-omega-vert="house"'), 'type arg').toBeTruthy();
        ctx.expect(html.includes('data-omega-vert-size="banner"'), 'size arg').toBeTruthy();
        ctx.expect(html.includes('data-omega-vert-id="promo1"'), 'vert_id pin').toBeTruthy();
        ctx.expect(html.includes('data-omega-vert-tags="dev,news"'), 'tags array joins').toBeTruthy();
        ctx.expect(html.includes('class="my-4"'), 'section_class knob').toBeTruthy();
        ctx.expect(html.includes('class="omega-vert-unit"'), 'inner mount host').toBeTruthy();
        ctx.expect(html.includes('data-omega-bind="@hide auth.user.active"'), 'paying users hide via the standard binding').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: 'verts/unit: neutral mechanical defaults — display/rectangle, no pins, no tags attr',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender('{% section "verts/unit" %}', {});

        ctx.expect(html.includes('data-omega-vert="display"'), 'default type').toBeTruthy();
        ctx.expect(html.includes('data-omega-vert-size="rectangle"'), 'default size').toBeTruthy();
        ctx.expect(!html.includes('data-omega-vert-id'), 'no vert_id attribute without the arg').toBeTruthy();
        ctx.expect(!html.includes('data-omega-vert-tags'), 'no tags attribute without the arg').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    // ─── §7 asset lanes + library resolution ────────────────────────────────────

    {
      name: 'verts/unit: registers both §7 asset lanes from the base layer',
      run: (ctx) => {
        const assets = collectSectionAssets([BASE]);
        const entry = assets.find((item) => item.kind === 'section' && item.id === 'verts/unit');

        ctx.expect(entry, 'entry collected').toBeTruthy();
        ctx.expect(entry.js && entry.js.endsWith('_sections/verts/unit/section.js'), 'section.js rides the main bundle').toBeTruthy();
        ctx.expect(entry.scss && entry.scss.endsWith('_sections/verts/unit/section.scss'), 'section.scss rides omega:sections').toBeTruthy();
      },
    },

    {
      name: 'verts/unit: resolves through the library under BOTH themes — newsflash falls through to base',
      run: (ctx) => {
        for (const roots of [[BASE], [NEWSFLASH, BASE]]) {
          const library = buildSectionLibrary({ baseDirs: roots });
          const entry = library.entries.find((item) => item.kind === 'section' && item.id === 'verts/unit');
          ctx.expect(entry, `verts/unit resolves over ${roots.length} layer(s)`).toBeTruthy();
          ctx.expect(entry.source, 'chips the base layer').toBe('base');
        }
      },
    },

    {
      name: 'verts/unit: section.js delegates WHOLLY to the shared client verts module (one implementation)',
      run: (ctx) => {
        const js = fs.readFileSync(path.join(BASE, '_sections', 'verts', 'unit', 'section.js'), 'utf8');
        ctx.expect(js.includes('export default (el, { omega })'), 'takes the host instance from the section init argument').toBeTruthy();
        ctx.expect(!js.includes('@omega.js/web'), 'imports no host instance module').toBeTruthy();
        ctx.expect(js.includes('omega.verts.mount'), 'delegates lazy-arm + ladder to the client verts module').toBeTruthy();
        ctx.expect(!js.includes('IntersectionObserver'), 'no private lazy fork — the module owns the observer').toBeTruthy();
        ctx.expect(!js.includes('createElement'), 'no DOM construction in the section — the module owns the iframe').toBeTruthy();
      },
    },

    {
      name: 'verts/unit: the host paints NO chrome — the card inside the frame owns bg, border, radius',
      run: (ctx) => {
        const scss = fs.readFileSync(path.join(BASE, '_sections', 'verts', 'unit', 'section.scss'), 'utf8');
        const chrome = /(background|border|border-radius|box-shadow|overflow)\s*:/;

        // Only the iframe reset (display/width/border: 0) may declare anything
        const hostBlock = scss.slice(scss.indexOf('.omega-vert-unit {'), scss.indexOf('iframe {'));
        ctx.expect(!chrome.test(hostBlock), 'the unit host declares no surface and no clipping').toBeTruthy();

        // A theme sheet radius clips the card's own corners — none may exist
        const offenders = [];
        const scan = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scan(full);
            } else if (entry.name.endsWith('.scss')) {
              const contents = fs.readFileSync(full, 'utf8');
              const block = contents.match(/\.omega-vert-unit\s*\{[^}]*\}/g) || [];
              if (block.some((rule) => chrome.test(rule))) {
                offenders.push(path.relative(PKG, full));
              }
            }
          }
        };
        [path.join(PKG, 'themes', 'classy', 'css'), path.join(NEWSFLASH, 'css')].forEach(scan);

        ctx.expect(offenders, 'no theme sheet dresses the vert host').toEqual([]);
      },
    },

    // ─── the legacy is retired (step 5) ─────────────────────────────────────────

    {
      name: 'spec step 5 taken: legacy vert.js, popupads.js + adunits includes are GONE',
      run: (ctx) => {
        for (const relative of ['core/js/modules/vert.js', 'core/js/modules/popupads.js', 'core/_includes/modules/adunits']) {
          ctx.expect(!fs.existsSync(path.join(PKG, relative)), `${relative} deleted`).toBeTruthy();
        }
      },
    },

    {
      name: 'no packaged source references the retired legacy lane',
      run: (ctx) => {
        const roots = ['core', 'defaults', 'themes'].map((dir) => path.join(PKG, dir));
        const offenders = [];

        const scan = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scan(full);
            } else if (/\.(js|html|scss|json5?|md)$/.test(entry.name)) {
              const contents = fs.readFileSync(full, 'utf8');
              if (/vert\.bundle|adunits\/|popupads/.test(contents)) {
                offenders.push(path.relative(PKG, full));
              }
            }
          }
        };
        roots.forEach(scan);

        ctx.expect(offenders, 'no vert.bundle/adunits/popupads references remain in packaged layers').toEqual([]);
      },
    },
  ],
});

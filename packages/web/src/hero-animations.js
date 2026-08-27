/**
 * hero-animations.js — the hero's custom-animation slot
 * ([#441](https://github.com/Omega-JS-Stack/omega/issues/441), Ian's ruling
 * 2026-08-25).
 *
 * A brand that wants a moving hero visual makes ONE folder and names it:
 *
 *   src/_hero/orbit/
 *     index.html   the markup
 *     style.scss   its styles   → the main sheet, like a section's scss
 *     script.js    its behavior → the main bundle, like a section's js
 *
 *   {% section "marketing/hero" %}
 *   demo:
 *     enabled: true
 *     type: custom
 *     name: orbit
 *   {% endsection %}
 *
 * Resolution is the layer chain, exactly like `_sections`/`_components`:
 * consumer first, then the theme layers — so a brand overrides a shipped
 * animation by owning the name, and the FIRST folder with an `index.html` wins
 * the whole entry (markup and assets travel together).
 *
 * Why this is not a third `KINDS` entry: a hero animation is not a composable
 * band. It has no args schema, no gallery, no demo variants, and Ian named its
 * files after what they ARE (`style`, `script`) rather than after the folder.
 * What it DOES share is the asset lane — the collector returns the same
 * `{ kind, id, scss, js }` shape `collectSectionAssets` does, so the sass
 * `omega:sections` importer and the main bundle's `bootSections` registry take
 * it with no special case: the markup carries `data-omega-hero="<name>"` and
 * `script.js` inits per element like any section module.
 */
const fs = require('node:fs');
const path = require('node:path');
const reads = require('@omega.js/devkit/reads');

// The folder family, and what a folder must hold. `index.html` is the entry —
// a folder without one is not an animation, whatever else is in it.
const HERO_DIR = '_hero';
const HERO_FILES = { html: 'index.html', scss: 'style.scss', js: 'script.js' };

// Names are single kebab-case segments: an animation is referenced by name in
// frontmatter, and a path there would be a traversal waiting to happen.
const HERO_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Collect every resolved hero animation across the layer chain, in the asset
 * lane's own shape.
 * @param {string[]} baseDirs - resolution bases in precedence order (consumer
 *   dir first, then theme layers — registerSectionTags' order)
 * @returns {Array<{kind: string, id: string, html: string, scss: string|null, js: string|null}>}
 *   sorted by id, so the emitted sheet and bundle order are deterministic
 */
function collectHeroAnimations(baseDirs) {
  const entries = new Map(); // name → entry

  for (const base of baseDirs) {
    const dir = path.join(base, HERO_DIR);
    if (!fs.existsSync(dir)) continue;

    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!item.isDirectory() || !HERO_NAME.test(item.name)) continue;
      if (entries.has(item.name)) continue; // a higher layer already won

      const entryDir = path.join(dir, item.name);
      const html = path.join(entryDir, HERO_FILES.html);
      if (!fs.existsSync(html)) continue;

      const scss = path.join(entryDir, HERO_FILES.scss);
      const js = path.join(entryDir, HERO_FILES.js);
      entries.set(item.name, {
        kind: 'hero',
        id: item.name,
        html,
        scss: fs.existsSync(scss) ? scss : null,
        js: fs.existsSync(js) ? js : null,
      });
    }
  }

  return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Register `{% hero_animation <name expression> %}` on a LiquidJS engine — the
 * ONE reader of the folder, used by the `marketing/hero` section's custom demo
 * branch. It is a TAG rather than a global because section markup is
 * context-free by contract: page globals never reach it, and registered tags do.
 *
 * The markup renders in an empty scope for the same reason a section does — the
 * `omega_*` tags and filters work, the calling page's data does not leak in.
 * The wrapper carries `data-omega-hero="<name>"`, which is what boots the
 * folder's `script.js` (runtime/boot.js `bootSections`).
 *
 * @param {object} engine - LiquidJS engine (Eleventy's, via amendLibrary)
 * @param {object} options
 * @param {string[]} options.baseDirs - resolution bases in precedence order
 */
function registerHeroAnimationTag(engine, options) {
  const roots = options.baseDirs
    .map((dir) => path.join(dir, HERO_DIR))
    .filter((dir) => fs.existsSync(dir));

  // Per-registration caches — roots are fixed for a build, so a resolved path
  // and its parsed template never go stale within one.
  const pathCache = new Map(); // name → abs index.html | null
  const templateCache = new Map(); // abs path → parsed templates

  const resolveAnimation = (name) => {
    if (pathCache.has(name)) return pathCache.get(name);
    let found = null;
    for (const root of roots) {
      const html = path.join(root, name, HERO_FILES.html);
      if (fs.existsSync(html)) { found = html; break; }
    }
    pathCache.set(name, found);
    return found;
  };

  engine.registerTag('hero_animation', {
    parse(tagToken) {
      this.markup = String(tagToken.args || '').trim();
    },

    * render(context, emitter) {
      const quoted = this.markup.match(/^"([^"]+)"$|^'([^']+)'$/);
      const name = quoted
        ? (quoted[1] ?? quoted[2])
        : yield this.liquid.evalValue(this.markup, context);

      if (typeof name !== 'string' || !name) {
        throw new Error(`{% hero_animation ${this.markup} %}: the name must resolve to a folder name string — got ${JSON.stringify(name)}`);
      }
      if (!HERO_NAME.test(name)) {
        throw new Error(`{% hero_animation "${name}" %}: hero animation names are one kebab-case segment (src/${HERO_DIR}/${name}/)`);
      }

      const html = resolveAnimation(name);
      if (!html) {
        throw new Error(
          `{% hero_animation "${name}" %}: no ${HERO_DIR}/${name}/${HERO_FILES.html} in any layer `
          + `(${roots.join(', ') || 'no roots'})`,
        );
      }

      let templates = templateCache.get(html);
      if (!templates) {
        templates = this.liquid.parse(fs.readFileSync(html, 'utf8'), html);
        templateCache.set(html, templates);
      }

      emitter.write(`<div class="omega-hero-animation" data-omega-hero="${name}">`);
      emitter.write(yield this.liquid.render(templates, {}));
      emitter.write('</div>');
    },
  });
}

/**
 * Register every hero-animation folder as a dev WATCH target — the same probe
 * the section walk does, so a new folder (or an edit inside one) resets the
 * config instead of serving a captured resolution.
 * @param {string[]} baseDirs
 */
function watchHeroAnimations(baseDirs) {
  for (const base of baseDirs) reads.dirExists(path.join(base, HERO_DIR));
}

module.exports = { collectHeroAnimations, registerHeroAnimationTag, watchHeroAnimations, HERO_DIR, HERO_FILES };

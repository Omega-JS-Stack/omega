/**
 * Runtime icon upgrading — the browser half of the ONE icon system
 * ([#619](https://github.com/Omega-JS-Stack/omega/issues/619)).
 *
 * The build inlines every icon the RENDERED page names (src/inline-icons.js),
 * so a static page pays nothing here. This is what covers the rest: an `<i>`
 * a page module builds after the fact, or an icon whose classes JS changes
 * mid-flight. @omega.js/client's icon-renderer is the shared watcher (one
 * MutationObserver, insertions AND class changes, the same module desktop and
 * extension pages run); web supplies only the transport — the site's OWN
 * emitted icon set, one file per icon actually asked for.
 *
 * Zero cost until requested: no icon transfers until an element that needs it
 * appears, and each one transfers once per page.
 *
 * Part of the boot runtime rather than the `__main_assets__` layer: it runs on
 * EVERY page, main bundle or not, and its imports must resolve identically in
 * the monorepo and in a published install — hence the relative paths.
 */
import { createIconRenderer } from '@omega.js/client/modules/icon-renderer.js';
import { ICONS_DIR, candidateRelPaths } from '@omega.js/client/modules/icon-core.js';
import { siteUrl } from '../core/js/libs/path-prefix.js';
import { createLogger } from '../core/js/libs/logger.js';

const logger = createLogger('icons');

// Where the build shipped the set (icon-core's ICONS_DIR, the same leaf
// @omega.js/devkit/icons emits under): the FA styles the brand's chain
// supplies, plus `flags/` for the second namespace.
export const ICON_BASE = `/assets/${ICONS_DIR}`;

/**
 * The web transport: one icon, from this site's own origin.
 *
 * Candidates are icon-core's — the requested style, then `brands/` — the same
 * order the build-time inlining pass and desktop's icon server walk, so
 * `<i class="fa-solid fa-github">` renders here exactly as it does there
 * (docs/shared/icons.md § Styles).
 *
 * A miss is LOUD in development — a console error naming the icon, because a
 * silently empty box is how a typo survives to production — and silent in
 * production, where a missing icon must never be worse than a missing icon.
 *
 * @param {object} [options]
 * @param {boolean} [options.development] - whether to report misses
 * @returns {function(string, string): Promise<string|null>} (name, style) → SVG text
 */
export function createIconResolver({ development } = {}) {
  return async (name, style) => {
    const misses = [];

    for (const rel of candidateRelPaths(name, style)) {
      const url = siteUrl(`${ICON_BASE}/${rel}`);
      // Sequential by definition: brands/ is only ever asked for when the
      // requested style dir has no such file.
      const response = await fetch(url);
      if (response.ok) return response.text();
      misses.push(`${url} answered ${response.status}`);
    }

    if (development) {
      logger.error(`Missing icon "${style}/${name}" — ${misses.join('; ')}`);
    }
    return null;
  };
}

/**
 * The watcher, bound to this site's transport.
 *
 * @param {object} [options]
 * @param {boolean} [options.development] - whether misses are reported
 * @returns {{ start: function, stop: function, scan: function }}
 */
export function createIconWatcher({ development } = {}) {
  return createIconRenderer({ resolve: createIconResolver({ development }) });
}

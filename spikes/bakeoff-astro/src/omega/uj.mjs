/**
 * uj.mjs — template-kit as DIRECT HELPER IMPORTS (the Astro adapter path
 * the A2 "uj_* adapter ergonomics" dimension scores).
 *
 * Filters are plain functions (`uj.ujTitleCase(name)`); tags keep their
 * engine-neutral `{ render(ctx, markup) }` shape, so `ujTag()` builds the
 * ctx that registerLiquid() builds for LiquidJS — lookup over an explicit
 * scope instead of a render context.
 */
import path from 'node:path';
import templateKit from '@omega.js/template-kit';
import { SPIKE } from './paths.mjs';
import { getCollection, getCollectionNames } from './collections.mjs';

const { filters, TAGS } = templateKit;

/** The uj_* filters as plain functions (ujTitleCase, ujCommaify, …). */
export const uj = filters;

/**
 * Render a uj tag directly from a component.
 * @param {string} name - tag name as registered ('uj_icon', 'urlmatches', …)
 * @param {string} markup - raw tag markup (quote literals: '"rocket"')
 * @param {object} [scope] - variable scope for markup refs (site, page, …)
 * @returns {string}
 */
export function ujTag(name, markup, scope = {}) {
  const ctx = {
    lookup: (dotPath) => String(dotPath).split('.').reduce((node, key) => (node == null ? undefined : node[key]), scope),
    page: scope.page || null,
    site: {
      config: scope.site || {},
      getCollection,
      getCollectionNames,
      fileExists: () => false,
    },
    options: {
      icons: {
        fontAwesomeDir: path.join(SPIKE, 'core', 'icons'),
        flagsDir: path.join(SPIKE, 'core', 'icons', 'flags'),
        style: 'solid',
      },
      logos: { dir: path.join(SPIKE, 'core', 'logos') },
    },
  };

  return TAGS[name].render(ctx, markup) || '';
}

/**
 * Jekyll's `date: "%B %d, %Y"` for post dates — UTC (filename dates are UTC
 * midnights; CI Jekyll parity).
 * @param {Date|string} date
 * @returns {string} e.g. "January 15, 2024"
 */
export function formatPostDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: '2-digit', // Jekyll's %d zero-pads ("September 05, 2024")
  });
}

/**
 * Jekyll's `slugify` filter equivalent (mirrors the corpus generator).
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

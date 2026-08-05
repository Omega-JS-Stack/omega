// Graphs — the framework's mermaid, drawn in the theme's own colors.
//
// The dependency is the FRAMEWORK's: mermaid is a dependency of @omega.js/web,
// never a CDN load at runtime, and a page reaches it ONLY through this module.
// Consumers import these helpers and never name the library, so its version and
// delivery stay ours to change — the charts helper's contract, for diagrams.
//
// It is still lazy: the import below is dynamic, and the bundle is ESM with
// splitting (src/assets.js), so mermaid lands in its own chunk that a page
// fetches the moment it asks for a graph — a page with no graph pays nothing.
//
// This module takes a DEFINITION in and puts an SVG out: composing the mermaid
// text is the page's business, because the shapes and the words in a diagram
// are content, not framework.
//
// The colors come off the token sheet (docs/shared/theming.md), which is what
// makes a diagram follow the brand ramp and dark mode without knowing either
// exists — and its categorical slots read the SAME ramp (--omega-chart-1…6) a
// chart series and an `.omega-badge-tone` chip do, so one thing is one color
// wherever it is drawn. Like charts, the tokens are read at DRAW time and
// nothing listens for a theme flip: a light/dark switch takes effect on the
// consumer's next redraw.
//
// `drawGraph` is not unit-tested (test/graph.test.js pins everything around
// it): mermaid renders against a real DOM, which node has none of — the same
// line the four chart builders sit on.

// Element ids are authored — a graph is drawn into a slot the page wrote — so
// the slot never escapes, it REFUSES anything that is not a plain id.
const ID_SHAPE = /^[a-z][\w-]*$/i;

// The graph library, once it is here. Set by loadGraph, read by every draw.
let mermaid = null;
let pending = null;

/**
 * Load mermaid once. Idempotent and safe to call on every poll.
 *
 * The one cost of a split chunk: it is a network fetch, so a page loaded
 * offline has no diagrams. `graphSlot` says so in place of the host rather
 * than leaving a hole.
 *
 * @returns {Promise<boolean>} whether mermaid is available
 */
export async function loadGraph() {
  if (mermaid) {
    return true;
  }

  if (!pending) {
    pending = (async () => {
      try {
        const module = await import('mermaid');
        mermaid = module.default;
        return true;
      } catch (e) {
        pending = null; // a later poll may find the network back
        console.warn('Failed to load mermaid:', e);
        return false;
      }
    })();
  }

  return pending;
}

/**
 * Whether a graph can be drawn right now — synchronous, for render paths.
 * @returns {boolean}
 */
export const graphReady = () => Boolean(mermaid);

/**
 * The theme's diagram colors, read off :root as mermaid themeVariables.
 *
 * Mermaid paints with literal colors, never `var()` strings, so every token is
 * resolved here — the charts helper's `resolveColor` idiom, applied to a whole
 * theme at once. Fallbacks run token → Bootstrap variable → hardcoded, so a
 * surface that carries neither sheet still draws something legible.
 *
 * @returns {object} mermaid themeVariables for the `base` theme
 */
export function graphTheme() {
  const style = getComputedStyle(document.documentElement);
  const token = (name) => style.getPropertyValue(name).trim();
  const ink = token('--omega-ink') || token('--bs-body-color') || '#212529';
  const surface = token('--omega-surface') || '#ffffff';
  const surface2 = token('--omega-surface-2') || '#f1f1f0';
  const line = token('--omega-line') || token('--bs-border-color') || '#dee2e6';
  const accent = token('--omega-accent') || '#2563eb';

  const theme = {
    background: surface,
    // A node is the recessed well on the page surface, outlined in the accent
    // — the one place the brand color lands in a diagram.
    mainBkg: surface2,
    primaryColor: surface2,
    primaryTextColor: ink,
    primaryBorderColor: accent,
    secondaryColor: surface,
    tertiaryColor: surface2,
    nodeBorder: accent,
    clusterBkg: surface,
    clusterBorder: line,
    edgeLabelBackground: surface,
    // Edges and their labels are hairlines and body ink, like every other
    // divider and line of text on the page.
    lineColor: line,
    textColor: ink,
    titleColor: ink,
    fontFamily: token('--omega-font-ui') || 'inherit',
  };

  // The categorical ramp, under both names mermaid takes per-item colors by:
  // cScale for the class/state/journey slots, pie for pie slices. An unset
  // slot is left out so mermaid derives its own rather than painting empty.
  [1, 2, 3, 4, 5, 6].forEach((slot) => {
    const color = token(`--omega-chart-${slot}`);
    if (color) {
      theme[`cScale${slot - 1}`] = color;
      theme[`pie${slot}`] = color;
    }
  });

  return theme;
}

/** Escape a definition for the attribute it is stamped into. */
const escapeAttribute = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * The markup a graph is drawn into. The host is empty until the render lands,
 * so the box carries a height FLOOR — it reserves the space instead of letting
 * the page jump, and a taller diagram still grows past it. When the library
 * did not load, the slot says so rather than leaving a hole.
 *
 * `definition` is the mermaid text the graph will draw, stamped onto the host:
 * a live page only redraws when `swap` wrote (@omega.js/client/modules/live-page),
 * and the host carries no data of its own, so without the stamp a
 * definition-only change leaves the old picture standing.
 *
 * @param {string} id - the host id the draw call will name
 * @param {number} [height] - the box height floor in px
 * @param {string} [definition] - the mermaid definition the graph will draw
 * @returns {string} markup
 */
export function graphSlot(id, height = 320, definition = '') {
  // An id is authored, never user input — a bad one is a programmer error.
  if (!ID_SHAPE.test(id)) {
    throw new Error(`[graph] graphSlot: "${id}" is not a usable element id`);
  }

  if (!graphReady()) {
    return '<p class="omega-micro text-body-secondary mb-0">graph library unavailable — the diagram could not be drawn</p>';
  }

  return `<div id="${id}" style="min-height: ${Number(height)}px;" data-series="${escapeAttribute(definition)}"></div>`;
}

/**
 * Draw a mermaid definition into `id`, replacing whatever was there (every
 * poll repaints).
 *
 * The theme is applied per render because the tokens are read per render — one
 * initialize, then the render that uses it. A definition that does not parse
 * throws: like the id, the diagram text is authored, so a syntax error in it
 * is a programmer error and says so instead of quietly drawing nothing.
 *
 * @param {string} id - the host id from `graphSlot`
 * @param {string} definition - the mermaid definition to render
 * @returns {Promise<string|null>} the SVG that was drawn, or null when nothing was
 */
export async function drawGraph(id, definition) {
  if (!mermaid) {
    return null;
  }

  const host = document.getElementById(id);
  if (!host) {
    return null;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    // Still throws on a bad definition, but mermaid cleans up its scratch
    // node first — without this it leaves its error diagram on document.body.
    suppressErrorRendering: true,
    theme: 'base',
    themeVariables: graphTheme(),
  });

  const { svg } = await mermaid.render(`${id}-svg`, definition);
  host.innerHTML = svg;

  return svg;
}

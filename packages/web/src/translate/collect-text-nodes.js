/**
 * Collect every translatable text unit from a built HTML page (cheerio DOM):
 * element text nodes, <title>, translatable meta contents, and translatable
 * attributes. The walk order is deterministic, so collecting again on a fresh
 * DOM yields positionally-aligned nodes for applying translations.
 *
 * Ported from UJM's collectTextNodes with two fixes: aria-describedby /
 * aria-labelledby are no longer collected (they are ID references —
 * translating them breaks the link), and `value` is only collected on
 * button-like inputs (translating hidden/token input values corrupted forms).
 * Opt-out: any element inside [data-omega-no-translate] is skipped.
 */

// Meta tags whose content is human-visible copy
const META_KEYS = ['description', 'og:title', 'og:description', 'twitter:title', 'twitter:description'];

// Attributes carrying human-visible copy on any element
const TEXT_ATTRIBUTES = ['title', 'placeholder', 'alt', 'aria-label', 'aria-placeholder', 'label'];

// input types whose `value` is a visible label
const BUTTON_INPUT_TYPES = ['button', 'submit', 'reset'];

/**
 * Walk the DOM and collect translatable units.
 * @param {object} $ - cheerio root
 * @returns {Array<{ node: object, type: 'text'|'attr'|'data', attr: string|null, reference?: object, text: string }>}
 */
function collectTextNodes($) {
  const textNodes = [];

  $('*').each((_, el) => {
    const node = $(el);

    if (node.is('script') || node.is('style') || node.is('noscript')) {
      return;
    }

    if (node.closest('[data-omega-no-translate]').length) {
      return;
    }

    // <title>
    if (node.is('title')) {
      const text = node.text().trim();
      if (text) {
        textNodes.push({ node, type: 'text', attr: null, text });
      }
      return;
    }

    // Translatable meta content
    if (node.is('meta')) {
      const key = node.attr('name') || node.attr('property');
      if (META_KEYS.includes(key)) {
        const text = node.attr('content')?.trim();
        if (text) {
          textNodes.push({ node, type: 'attr', attr: 'content', text });
        }
      }
      return;
    }

    // Translatable attributes
    const attributes = [...TEXT_ATTRIBUTES];
    if (node.is('input') && BUTTON_INPUT_TYPES.includes(node.attr('type'))) {
      attributes.push('value');
    }

    attributes.forEach((attr) => {
      const text = node.attr(attr)?.trim();
      if (text) {
        textNodes.push({ node, type: 'attr', attr, text });
      }
    });

    // Regular DOM text nodes (direct children only — descendants get their own visit)
    node.contents().each((_, child) => {
      if (child.type === 'text' && child.data?.trim()) {
        const text = child.data
          // Preserve a single leading/trailing whitespace, normalize the rest
          .replace(/^\s*(\s)\s*/, '$1')
          .replace(/\s*(\s)\s*$/, '$1')
          .replace(/\s+/g, ' ');

        textNodes.push({ node, type: 'data', attr: null, reference: child, text });
      }
    });
  });

  return textNodes;
}

module.exports = { collectTextNodes };

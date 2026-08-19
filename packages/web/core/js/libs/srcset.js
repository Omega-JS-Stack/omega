/**
 * The srcset candidate parser for the BROWSER (#367) — the ESM twin of the
 * build-time `packages/web/src/srcset.js`. Same grammar, same output shape; two
 * files because the two lanes cannot share one: the build passes are CJS node
 * modules, and this one is bundled into the page's ESM bundle.
 *
 * ⚠️ FORMAT TWIN — keep in step with `packages/web/src/srcset.js`. A change to
 * how a candidate is parsed belongs in BOTH files, or the runtime lazy-loader
 * and the two build passes stop agreeing about what a candidate is.
 *
 * Why it exists: #362 fixed `value.split(',')` in the two HTML passes, and the
 * runtime lazy-loader (`core/js/core/lazy-loading.js`) kept it — and it is the
 * lane the build passes DEFER `data-srcset` to, so a candidate URL carrying a
 * legal comma (a `data:` payload, a `?w=100,200` query) was still cut in half
 * in the browser.
 *
 * Candidates are parsed the way the HTML srcset grammar actually works: the URL
 * is a run of NON-WHITESPACE characters (commas inside it belong to the URL),
 * the boundary is the comma that ends a candidate — either trailing the URL
 * itself (descriptor-less form) or after the descriptor list.
 */

/**
 * Rewrite every candidate URL in a srcset value, keeping the descriptors and
 * the `, ` separator.
 * @param {string} value - srcset attribute value
 * @param {Function} mapUrl - (url: string) → string, the caller's URL rewrite
 * @returns {string}
 */
export function mapSrcset(value, mapUrl) {
  const input = String(value);
  const candidates = [];
  let i = 0;

  while (i < input.length) {
    // Leading whitespace and the empty candidates a stray comma leaves behind
    while (i < input.length && /[\s,]/.test(input[i])) i++;
    if (i >= input.length) break;

    const urlStart = i;
    while (i < input.length && !/\s/.test(input[i])) i++;
    const url = input.slice(urlStart, i);

    // A URL ending in commas IS the boundary (the descriptor-less form) —
    // strip them and the candidate is done; otherwise the descriptors run to
    // the next comma outside a parenthesized group.
    if (url.endsWith(',')) {
      candidates.push({ url: url.replace(/,+$/, ''), descriptor: '' });
      continue;
    }

    const descriptorStart = i;
    let depth = 0;
    while (i < input.length) {
      const char = input[i];
      if (char === '(') depth++;
      else if (char === ')') depth = Math.max(0, depth - 1);
      else if (char === ',' && depth === 0) break;
      i++;
    }

    candidates.push({ url, descriptor: input.slice(descriptorStart, i).trim() });
    i++; // the boundary comma
  }

  return candidates
    .map(({ url, descriptor }) => [mapUrl(url), ...(descriptor ? [descriptor] : [])].join(' '))
    .join(', ');
}

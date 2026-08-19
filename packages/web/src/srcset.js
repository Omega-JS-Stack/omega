/**
 * The ONE srcset candidate parser (#362). Both HTML passes rewrite the URL of
 * every candidate in a `srcset` attribute — cachebreak-html.js stamps it,
 * path-prefix.js mounts it — and each carried its own `value.split(',')`, so
 * the same bug shipped twice: a candidate URL may legally contain a comma (a
 * `data:` payload, a query string like `?w=100,200`), and splitting on every
 * comma cuts those in half.
 *
 * ⚠️ FORMAT TWIN — keep in step with `core/js/libs/srcset.js`, the ESM copy the
 * runtime lazy-loader uses for the `data-srcset` lane these passes defer to
 * (#367). A change to how a candidate is parsed belongs in BOTH files.
 *
 * Candidates are parsed the way the HTML srcset grammar actually works: the
 * URL is a run of NON-WHITESPACE characters (commas inside it belong to the
 * URL), the boundary is the comma that ends a candidate — either trailing the
 * URL itself (descriptor-less form) or after the descriptor list.
 */

/**
 * Rewrite every candidate URL in a srcset value, keeping the descriptors and
 * the `, ` separator the passes have always emitted.
 * @param {string} value - srcset attribute value
 * @param {Function} mapUrl - (url: string) → string, the pass's URL rewrite
 * @returns {string}
 */
function mapSrcset(value, mapUrl) {
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

module.exports = { mapSrcset };

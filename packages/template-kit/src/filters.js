/**
 * filters.js — the omega_* Liquid filters as plain JS.
 *
 * Ported from jekyll-uj-powertools lib/filters/main.rb (READ-ONLY reference).
 * Pure functions except the engine-coupled pair (omegaLiquify / omegaContentFormat),
 * which are factories taking the engine's render/markdown hooks — the
 * register-liquid.js adapter wires those to a real LiquidJS instance.
 *
 * Registered filter names keep their Jekyll spelling (omega_strip_ads, …) via
 * the FILTER_NAMES map so templates port verbatim.
 */

// Libraries
const crypto = require('crypto');

// Consistent cache-busting timestamp for the lifetime of the process
// (Ruby parity: module-load `(Time.now.to_f * 1000).to_i`)
const CACHE_TIMESTAMP = String(Date.now());

/**
 * Strip ad units from content: <ad-unit> HTML blocks and adunit includes.
 * @param {string} input
 * @returns {string}
 */
function omegaStripAds(input) {
  return String(input)
    .replace(/\s*<ad-unit>[\s\S]*?<\/ad-unit>\s*/gm, '')
    .replace(/\s*\{% include \/master\/modules\/adunits\/[\s\S]*? %\}\s*/gm, '');
}

/**
 * Escape a string for embedding in JSON (no surrounding quotes).
 * @param {*} value
 * @returns {string}
 */
function omegaJsonEscape(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}

/**
 * Return a random integer in [0, input).
 * @param {number} input
 * @returns {number}
 */
function omegaRandom(input) {
  return Math.floor(Math.random() * Number(input));
}

/**
 * Deterministic number in [0, max) from an input string's MD5.
 * Ruby parity: full 128-bit hexdigest as an integer, mod max (BigInt math).
 * @param {*} input
 * @param {number} max
 * @returns {number}
 */
function omegaHash(input, max) {
  const digest = crypto.createHash('md5').update(String(input)).digest('hex');
  return Number(BigInt(`0x${digest}`) % BigInt(parseInt(max, 10)));
}

/**
 * Title-case each space-separated word (Ruby String#capitalize parity:
 * first char upcased, rest of the word downcased — "hello WORLD" => "Hello World").
 * @param {string} input
 * @returns {string}
 */
function omegaTitleCase(input) {
  return String(input)
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ');
}

/**
 * Pretty-print JSON with configurable indentation.
 * @param {*} input
 * @param {number} [indentSize=2]
 * @returns {string}
 */
function omegaJsonify(input, indentSize = 2) {
  return JSON.stringify(input, null, ' '.repeat(parseInt(indentSize, 10)));
}

/**
 * Append a query parameter to a URL, handling existing query strings.
 * @param {string} input
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
function omegaAppendParam(input, key, value) {
  if (input === null || input === undefined || String(input).trim() === '') return input;
  const url = String(input).trim();
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${key}=${value}`;
}

/**
 * Append a cache-busting `cb` parameter using the process-consistent timestamp.
 * @param {string} input
 * @returns {string}
 */
function omegaCachebreak(input) {
  return omegaAppendParam(input, 'cb', CACHE_TIMESTAMP);
}

/**
 * Pluralize a word based on a count (singular for exactly 1).
 * @param {number} count
 * @param {string} singular
 * @param {string} [plural] - defaults to singular + 's'
 * @returns {string}
 */
function omegaPluralize(count, singular, plural) {
  const resolved = plural || `${singular}s`;
  return parseInt(count, 10) === 1 ? singular : resolved;
}

/**
 * Format a number with thousands commas (10000 => "10,000").
 * Non-numeric input passes through unchanged.
 * @param {*} input
 * @returns {*}
 */
function omegaCommaify(input) {
  if (input === null || input === undefined || input === false) return input;
  const str = String(input).trim();
  if (!str) return input;
  if (!/^-?\d+(\.\d+)?$/.test(str)) return input;

  const [whole, decimal] = str.split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal === undefined ? withCommas : `${withCommas}.${decimal}`;
}

/**
 * Factory: increment a render-scoped counter and return the new value.
 * @param {function} getRegisters - () => a mutable per-render registers object
 * @returns {function} (input) => number
 */
function createIncrementReturn(getRegisters) {
  return function omegaIncrementReturn(input) {
    const registers = getRegisters();
    registers.omegaIncrementalReturn = (registers.omegaIncrementalReturn || 0) + Number(input);
    return registers.omegaIncrementalReturn;
  };
}

/**
 * Factory: recursively render Liquid syntax within a string.
 * @param {function} render - (templateString) => rendered string (sync, current context)
 * @returns {function} (input, maxDepth) => string
 */
function createLiquify(render) {
  return function omegaLiquify(input, maxDepth = 10) {
    if (input === null || input === undefined || input === false) return '';

    let depth = 0;
    let result = String(input);

    while ((result.includes('{{') || result.includes('{%')) && depth < maxDepth) {
      const next = render(result);
      if (next === result) break;
      result = next;
      depth++;
    }

    return result;
  };
}

/**
 * Factory: liquify, then markdownify when the current page is markdown.
 * @param {function} render - (templateString) => rendered string
 * @param {object} hooks
 * @param {function} [hooks.markdown] - (content) => HTML
 * @param {function} [hooks.getPage] - () => current page object (needs .extension)
 * @returns {function} (input) => string
 */
function createContentFormat(render, hooks = {}) {
  const liquify = createLiquify(render);

  return function omegaContentFormat(input) {
    if (input === null || input === undefined || input === false) return '';

    const liquified = liquify(input);
    const page = hooks.getPage ? hooks.getPage() : null;

    if (page && page.extension === '.md' && hooks.markdown) {
      return hooks.markdown(liquified);
    }
    return liquified;
  };
}

// Jekyll-spelled filter name => implementation (context-free filters only;
// the factories register separately in the engine adapter)
const FILTER_NAMES = {
  omega_strip_ads: omegaStripAds,
  omega_json_escape: omegaJsonEscape,
  omega_random: omegaRandom,
  omega_hash: omegaHash,
  omega_title_case: omegaTitleCase,
  omega_jsonify: omegaJsonify,
  omega_append_param: omegaAppendParam,
  omega_cachebreak: omegaCachebreak,
  omega_pluralize: omegaPluralize,
  omega_commaify: omegaCommaify,
};

module.exports = {
  CACHE_TIMESTAMP,
  FILTER_NAMES,
  omegaStripAds,
  omegaJsonEscape,
  omegaRandom,
  omegaHash,
  omegaTitleCase,
  omegaJsonify,
  omegaAppendParam,
  omegaCachebreak,
  omegaPluralize,
  omegaCommaify,
  createIncrementReturn,
  createLiquify,
  createContentFormat,
};

/**
 * filters.js — the omega_* Liquid filters as plain JS.
 *
 * Ported from jekyll-uj-powertools lib/filters/main.rb (READ-ONLY reference),
 * plus omega's own helpers behind the retired Jekyll-era names (jekyll-compat.js).
 * Pure functions except the factories (liquify, content format, the URL pair,
 * markdownify), which the register-liquid.js adapter wires to the engine.
 *
 * Registered filter names keep their Jekyll spelling (omega_strip_ads, …) via
 * the FILTER_NAMES map so templates port verbatim.
 */

// Libraries
const crypto = require('crypto');

// Consistent cache-busting timestamp for the lifetime of the process
// (Ruby parity: module-load `(Time.now.to_f * 1000).to_i`)
const CACHE_TIMESTAMP = String(Date.now());

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
 * JSON-encode a value: compact by default, pretty-printed when an indent is passed.
 * An absent value encodes as `null`, so the output is always valid JS.
 * @param {*} input
 * @param {number} [indentSize=0]
 * @returns {string}
 */
function omegaJsonify(input, indentSize = 0) {
  return JSON.stringify(input === undefined ? null : input, null, ' '.repeat(parseInt(indentSize, 10)));
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
 * The ONE slugifier: downcase, non-alphanumeric runs become '-'.
 * An apostrophe is DELETED, not separated on, so "Beginner's Guides" is
 * `beginners-guides`. Both spellings, straight and typographic: the markdown
 * typographer smartens the straight one, and one term must never answer to two slugs.
 * @param {string} input
 * @returns {string}
 */
function omegaSlugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toDate(input) {
  if (input === 'now' || input === 'today') return new Date();
  const parsed = input instanceof Date ? input : new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * ISO-8601 in UTC: "YYYY-MM-DDTHH:MM:SS+00:00".
 * Content dates are UTC midnights (dated filenames) and CI builds run UTC;
 * rendering in the builder's local zone would shift days.
 * @param {Date|string} input
 * @returns {string|Date} Formatted string; unparseable input passes through untouched
 */
function omegaDateXmlschema(input) {
  const date = toDate(input);
  if (!date) return input;

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
    + '+00:00';
}

/**
 * RFC-822 in UTC: "Fri, 07 Nov 2008 13:07:54 +0000".
 * @param {Date|string} input
 * @returns {string|Date} Formatted string; unparseable input passes through untouched
 */
function omegaDateRfc822(input) {
  const date = toDate(input);
  if (!date) return input;

  return `${DAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
    + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

/**
 * Strip HTML tags (script/style contents removed entirely).
 * @param {string} input
 * @returns {string}
 */
function omegaStripHtml(input) {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gm, '')
    .replace(/<style[\s\S]*?<\/style>/gm, '')
    .replace(/<!--[\s\S]*?-->/gm, '')
    .replace(/<[^>]+>/g, '');
}

/**
 * Word count.
 * @param {string} input
 * @returns {number}
 */
function omegaNumberOfWords(input) {
  const text = String(input).trim();
  return text ? text.split(/\s+/).length : 0;
}

/**
 * Evaluate the SIMPLE expression subset (`item.path <op> literal` with
 * ==, !=, >, <, >=, <=, contains, and bare paths) against an item, yielding the
 * expression's VALUE: a comparison yields its boolean, a bare path the value
 * it points at. Full Liquid expression support is out of scope.
 * @param {*} item
 * @param {string} variable - the loop variable name (e.g. "item")
 * @param {string} expression - e.g. "item.type == 'post'"
 * @returns {*}
 */
function evalExpressionValue(item, variable, expression) {
  const match = String(expression).trim().match(
    /^(.+?)\s*(==|!=|>=|<=|>|<|contains)\s*(.+)$/
  );

  const resolvePath = (pathExpr) => {
    const trimmed = pathExpr.trim();
    const literal = trimmed.match(/^["'](.*)["']$/);
    if (literal) return literal[1];
    if (trimmed === 'nil' || trimmed === 'null') return null;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

    const parts = trimmed.split('.');
    if (parts[0] !== variable) return undefined;

    let current = item;
    for (const part of parts.slice(1)) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  };

  // Bare path: the value it points at (callers decide what to do with it)
  if (!match) return resolvePath(expression);

  const left = resolvePath(match[1]);
  const right = resolvePath(match[3]);

  switch (match[2]) {
    case '==': return left == right; // eslint-disable-line eqeqeq -- Liquid equality is loose
    case '!=': return left != right; // eslint-disable-line eqeqeq
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    case 'contains':
      if (typeof left === 'string') return left.includes(String(right));
      if (Array.isArray(left)) return left.includes(right);
      return false;
    default: return false;
  }
}

/**
 * Keep the items whose expression is truthy (simple-expression subset).
 * @param {Array} input
 * @param {string} variable
 * @param {string} expression
 * @returns {Array}
 */
function omegaWhere(input, variable, expression) {
  return [].concat(input || []).filter((item) => {
    const value = evalExpressionValue(item, variable, expression);
    return !(value === null || value === undefined || value === false);
  });
}

/**
 * Bucket the items by their expression VALUE: one group per distinct value,
 * groups in first-seen order, items in input order. An absent value groups
 * under '' so a rendered group name is never the text "undefined".
 * @param {Array} input
 * @param {string} variable
 * @param {string} expression
 * @returns {Array<{name: string, items: Array, size: number}>}
 */
function omegaGroupBy(input, variable, expression) {
  const groups = new Map();

  for (const item of [].concat(input || [])) {
    const value = evalExpressionValue(item, variable, expression);
    const key = value === null || value === undefined ? '' : String(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return [...groups.entries()].map(([name, items]) => ({ name, items, size: items.length }));
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

/**
 * Factory: prefix a path with site.baseurl.
 * @param {object} site - { baseurl }
 * @returns {function}
 */
function createRelativeUrl(site = {}) {
  return function omegaRelativeUrl(input) {
    const baseurl = String(site.baseurl || '').replace(/\/$/, '');
    let path = String(input);
    if (!path.startsWith('/')) path = `/${path}`;
    return `${baseurl}${path}`;
  };
}

/**
 * Factory: prefix a path with site.url + site.baseurl (an absolute URL passes through).
 * @param {object} site - { url, baseurl }
 * @returns {function}
 */
function createAbsoluteUrl(site = {}) {
  const relative = createRelativeUrl(site);
  return function omegaAbsoluteUrl(input) {
    if (/^https?:\/\//.test(String(input))) return input;
    const url = String(site.url || '').replace(/\/$/, '');
    return `${url}${relative(input)}`;
  };
}

/**
 * Factory: render markdown to HTML. The markdown converter is injected;
 * without one the input passes through unchanged.
 * @param {function} [markdown] - (content) => HTML
 * @returns {function}
 */
function createMarkdownify(markdown) {
  return function omegaMarkdownify(input) {
    if (input === null || input === undefined) return '';
    return markdown ? markdown(String(input)) : String(input);
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
  omega_slugify: omegaSlugify,
  omega_date_xmlschema: omegaDateXmlschema,
  omega_date_rfc822: omegaDateRfc822,
  omega_strip_html: omegaStripHtml,
  omega_number_of_words: omegaNumberOfWords,
  omega_where: omegaWhere,
  omega_group_by: omegaGroupBy,
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
  omegaSlugify,
  omegaDateXmlschema,
  omegaDateRfc822,
  omegaStripHtml,
  omegaNumberOfWords,
  omegaWhere,
  omegaGroupBy,
  createIncrementReturn,
  createLiquify,
  createContentFormat,
  createRelativeUrl,
  createAbsoluteUrl,
  createMarkdownify,
};

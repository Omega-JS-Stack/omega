/**
 * jekyll-compat.js — omega's template helpers under the familiar Jekyll-style
 * names (slugify, date_to_xmlschema, jsonify, strip_html, markdownify,
 * relative_url, absolute_url, where_exp, group_by_exp, number_of_words,
 * date_to_rfc822), as plain JS.
 *
 * The names are the authoring surface; the contract is CORRECT BEHAVIOR, not
 * emulation of Jekyll internals — where Jekyll's own semantics are surprising,
 * these do the sane thing and the tests pin it.
 *
 * where_exp/group_by_exp read the SIMPLE expression subset (`item.path ==
 * literal`, !=, >, <, >=, <=, contains, and bare paths) — full Liquid
 * expression support is out of scope; widen it when a site needs more.
 */

// Constants
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Jekyll slugify (default mode): downcase, non-alphanumeric runs => '-'.
 * @param {string} input
 * @returns {string}
 */
function slugify(input) {
  return String(input)
    .toLowerCase()
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
 * ISO-8601 in UTC, CI-Jekyll parity: "2008-11-07T13:07:54+00:00".
 * OMEGA convention: content dates are UTC midnights (dated filenames) and CI
 * builds run UTC — rendering in the builder's local zone would shift days.
 * @param {Date|string} input
 * @returns {string|Date} Formatted string; unparseable input passes through untouched
 */
function dateToXmlschema(input) {
  const date = toDate(input);
  if (!date) return input;

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
    + '+00:00';
}

/**
 * RFC-822 in UTC, CI-Jekyll parity: "Fri, 07 Nov 2008 13:07:54 +0000".
 * @param {Date|string} input
 * @returns {string|Date} Formatted string; unparseable input passes through untouched
 */
function dateToRfc822(input) {
  const date = toDate(input);
  if (!date) return input;

  return `${DAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
    + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

/**
 * JSON-encode a value (Jekyll's jsonify).
 * @param {*} input
 * @returns {string}
 */
function jsonify(input) {
  // Jekyll parity: nil.to_json == "null" (an absent value must still emit valid JS)
  return JSON.stringify(input === undefined ? null : input);
}

/**
 * Strip HTML tags (script/style contents removed entirely).
 * @param {string} input
 * @returns {string}
 */
function stripHtml(input) {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gm, '')
    .replace(/<style[\s\S]*?<\/style>/gm, '')
    .replace(/<!--[\s\S]*?-->/gm, '')
    .replace(/<[^>]+>/g, '');
}

/**
 * Word count (Jekyll's number_of_words).
 * @param {string} input
 * @returns {number}
 */
function numberOfWords(input) {
  const text = String(input).trim();
  return text ? text.split(/\s+/).length : 0;
}

/**
 * Factory: prefix a path with site.baseurl (Jekyll's relative_url).
 * @param {object} site - { baseurl }
 * @returns {function}
 */
function createRelativeUrl(site = {}) {
  return function relativeUrl(input) {
    const baseurl = String(site.baseurl || '').replace(/\/$/, '');
    let path = String(input);
    if (!path.startsWith('/')) path = `/${path}`;
    return `${baseurl}${path}`;
  };
}

/**
 * Factory: prefix a path with site.url + site.baseurl (Jekyll's absolute_url).
 * @param {object} site - { url, baseurl }
 * @returns {function}
 */
function createAbsoluteUrl(site = {}) {
  const relative = createRelativeUrl(site);
  return function absoluteUrl(input) {
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
  return function markdownify(input) {
    if (input === null || input === undefined) return '';
    return markdown ? markdown(String(input)) : String(input);
  };
}

/**
 * Evaluate the supported simple-expression subset against an item, yielding
 * the expression's VALUE — a comparison yields its boolean, a bare path the
 * value it points at.
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

  // Bare path — the value it points at (callers decide what to do with it)
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
function whereExp(input, variable, expression) {
  return [].concat(input || []).filter((item) => {
    const value = evalExpressionValue(item, variable, expression);
    return !(value === null || value === undefined || value === false);
  });
}

/**
 * Bucket the items by their expression VALUE — one group per distinct value,
 * groups in first-seen order, items in input order. An absent value groups
 * under '' so a rendered group name is never the text "undefined".
 * @param {Array} input
 * @param {string} variable
 * @param {string} expression
 * @returns {Array<{name: string, items: Array, size: number}>}
 */
function groupByExp(input, variable, expression) {
  const groups = new Map();

  for (const item of [].concat(input || [])) {
    const value = evalExpressionValue(item, variable, expression);
    const key = value === null || value === undefined ? '' : String(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return [...groups.entries()].map(([name, items]) => ({ name, items, size: items.length }));
}

// Context-free compat filters (factories register separately in the adapter)
const COMPAT_NAMES = {
  slugify,
  date_to_xmlschema: dateToXmlschema,
  date_to_rfc822: dateToRfc822,
  jsonify,
  strip_html: stripHtml,
  number_of_words: numberOfWords,
  where_exp: whereExp,
  group_by_exp: groupByExp,
};

module.exports = {
  COMPAT_NAMES,
  slugify,
  dateToXmlschema,
  dateToRfc822,
  jsonify,
  stripHtml,
  numberOfWords,
  whereExp,
  groupByExp,
  createRelativeUrl,
  createAbsoluteUrl,
  createMarkdownify,
};

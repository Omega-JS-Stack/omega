/**
 * jekyll-compat.js — Jekyll-specific Liquid filters as plain JS.
 *
 * Scoped by the real-usage audit (2026-07-06) across UJM's theme/blueprints
 * and consumer sites: slugify, date_to_xmlschema, jsonify, strip_html,
 * markdownify (+ push, which LiquidJS already ships). The plan's named extras
 * (relative_url, absolute_url, where_exp, group_by_exp, number_of_words,
 * date_to_rfc822) are included for the bake-off port surface.
 *
 * where_exp/group_by_exp implement the SIMPLE expression subset
 * (`item.path == literal`, !=, >, <, >=, <=, contains, and bare truthy paths)
 * — full Liquid expression parity is deliberately out of scope (zero real
 * usage found; revisit if a migrated site needs more).
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
  if (input instanceof Date) return input;
  if (input === 'now' || input === 'today') return new Date();
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * Timezone offset suffix for a date, e.g. "-08:00" (rfc822: "-0800").
 */
function tzOffset(date, separator) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${sign}${pad(Math.floor(abs / 60))}${separator}${pad(abs % 60)}`;
}

/**
 * ISO-8601 with local offset, Jekyll parity: "2008-11-07T13:07:54-08:00".
 * @param {Date|string} input
 * @returns {string}
 */
function dateToXmlschema(input) {
  const date = toDate(input);
  if (!date) return input;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + tzOffset(date, ':');
}

/**
 * RFC-822, Jekyll parity: "Fri, 07 Nov 2008 13:07:54 -0800".
 * @param {Date|string} input
 * @returns {string}
 */
function dateToRfc822(input) {
  const date = toDate(input);
  if (!date) return input;

  return `${DAYS[date.getDay()]}, ${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${tzOffset(date, '')}`;
}

/**
 * JSON-encode a value (Jekyll's jsonify).
 * @param {*} input
 * @returns {string}
 */
function jsonify(input) {
  return JSON.stringify(input);
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
 * Factory: liquify-then-markdown (Jekyll's markdownify). The markdown
 * converter is injected; without one the input passes through unchanged.
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
 * Evaluate the supported simple-expression subset against an item.
 * @param {*} item
 * @param {string} variable - the loop variable name (e.g. "item")
 * @param {string} expression - e.g. "item.type == 'post'"
 * @returns {boolean|*}
 */
function evalSimpleExpression(item, variable, expression) {
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

  if (!match) {
    // Bare path — truthiness
    const value = resolvePath(expression);
    return !(value === null || value === undefined || value === false);
  }

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
 * Jekyll's where_exp (simple-expression subset).
 * @param {Array} input
 * @param {string} variable
 * @param {string} expression
 * @returns {Array}
 */
function whereExp(input, variable, expression) {
  return [].concat(input || []).filter((item) => evalSimpleExpression(item, variable, expression));
}

/**
 * Jekyll's group_by_exp (simple-expression subset).
 * @param {Array} input
 * @param {string} variable
 * @param {string} expression
 * @returns {Array<{name: string, items: Array, size: number}>}
 */
function groupByExp(input, variable, expression) {
  const groups = new Map();

  for (const item of [].concat(input || [])) {
    const key = String(evalSimpleExpression(item, variable, expression));
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

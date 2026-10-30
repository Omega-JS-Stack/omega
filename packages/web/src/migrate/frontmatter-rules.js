/**
 * frontmatter-rules.js: the codemod rules that rewrite a legacy page's
 * frontmatter keys, each the `{ id, title, apply(text) }` shape of rules.js,
 * whose RULES table orders them. Frontmatter-scoped and TOP-LEVEL only: an
 * indented key belongs to some other block's data.
 */

const { toLines, fromLines } = require('./lines.js');

const NO_CHANGE = (text) => ({ text, edits: [], findings: [] });

/**
 * The line index that closes the frontmatter fence, or -1 when the file has none.
 * @param {string[]} lines
 * @returns {number}
 */
function fenceEndOf(lines) {
  return lines[0] === '---' ? lines.indexOf('---', 1) : -1;
}

/**
 * The index past a top-level key's indented body (blank lines end it).
 * @param {string[]} lines
 * @param {number} at - the key's own line
 * @param {number} limit - the fence's closing line
 * @returns {number}
 */
function blockEnd(lines, at, limit) {
  let end = at + 1;
  while (end < limit && /^\s+\S/.test(lines[end])) end++;
  return end;
}

/** A top-level key's inline value, any trailing YAML comment dropped. */
function inlineValue(line, key) {
  return line.slice(key.length + 1).replace(/\s+#.*$/, '').trim();
}

// `append: true` was the legacy add-below flag: the page body rendered BELOW
// the layout's default composition. A page body replaces it now, so the key
// renders the same as no key and is dropped here, with the finding that says so.
const appendFlag = {
  id: 'append-flag',
  title: 'the retired `append:` frontmatter flag → dropped',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const fenceEnd = fenceEndOf(lines);
    if (fenceEnd < 0) return NO_CHANGE(text);

    const at = lines.findIndex((line, index) => index > 0 && index < fenceEnd && /^append:/.test(line));
    if (at < 0) return NO_CHANGE(text); // already migrated: idempotent

    const out = [...lines];
    out.splice(at, 1);

    return {
      text: fromLines(out, trailingNewline),
      edits: [{ rule: 'append-flag', line: at + 1, before: lines[at].trim(), after: '' }],
      findings: [{
        check: 'append-flag', line: at + 1, severity: 'warning',
        message: '`append: true` is gone (#607): a page body REPLACES the layout\'s default composition, and there is no '
          + 'flag to keep both. Run `omega customize <url>` to materialize the default bands into this page, then edit them '
          + 'with your own content below',
      }],
    };
  },
};

/**
 * The sitemap lines left once the `include: false` opt-out is gone, or null
 * when the block carries no such opt-out.
 * @param {string[]} lines
 * @param {number} at - the `sitemap:` line
 * @param {number} end - the index past its body
 * @returns {string[]|null}
 */
function sitemapRemainder(lines, at, end) {
  const value = inlineValue(lines[at], 'sitemap');
  if (value === 'false') return [];

  if (value.startsWith('{')) {
    const pairs = value.replace(/^\{|\}$/g, '').split(',').map((pair) => pair.trim()).filter(Boolean);
    const rest = pairs.filter((pair) => !/^include\s*:\s*false$/.test(pair));
    if (rest.length === pairs.length) return null;
    return rest.length ? [`sitemap: { ${rest.join(', ')} }`] : [];
  }

  if (value !== '') return null;
  const body = lines.slice(at + 1, end);
  const include = body.findIndex((line) => /^\s+include\s*:\s*false\s*(#.*)?$/.test(line));
  if (include < 0) return null;
  const rest = body.filter((line, index) => index !== include);
  return rest.some((line) => /^\s+[^\s#]/.test(line)) ? ['sitemap:', ...rest] : [];
}

/**
 * Write `index: false` into the frontmatter's `meta:` block, or open one at
 * `at`. Returns the new lines, or null when the page already decides `meta.index`.
 * @param {string[]} lines
 * @param {number} at - where a new `meta:` block goes
 * @param {number} fenceEnd
 * @returns {string[]|null}
 */
function withMetaIndexFalse(lines, at, fenceEnd) {
  const meta = lines.findIndex((line, index) => index > 0 && index < fenceEnd && /^meta:/.test(line));
  if (meta < 0) return [...lines.slice(0, at), 'meta:', '  index: false', ...lines.slice(at)];

  const value = inlineValue(lines[meta], 'meta');
  if (value.startsWith('{')) {
    if (/[{,]\s*index\s*:/.test(value)) return null;
    const inner = value.replace(/^\{|\}$/g, '').trim();
    const rewritten = `meta: { ${inner ? `${inner}, ` : ''}index: false }`;
    return [...lines.slice(0, meta), rewritten, ...lines.slice(meta + 1)];
  }

  const body = lines.slice(meta + 1, blockEnd(lines, meta, fenceEnd));
  if (body.some((line) => /^\s+index\s*:/.test(line))) return null;
  const indent = (body.find((line) => /^\s+[^\s#]/.test(line)) || '  ').match(/^\s+/)[0];
  return [...lines.slice(0, meta + 1), `${indent}index: false`, ...lines.slice(meta + 1)];
}

// A legacy page left the sitemap with `sitemap: false` or `sitemap.include:
// false`. That opt-out is `meta.index: false` now, one flag for every index;
// any other `sitemap` key stays for the build's meta-only warning to name.
const sitemapIndex = {
  id: 'sitemap-index',
  title: '`sitemap: false` / `sitemap.include: false` → `meta.index: false`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const fenceEnd = fenceEndOf(lines);
    if (fenceEnd < 0) return NO_CHANGE(text);

    const at = lines.findIndex((line, index) => index > 0 && index < fenceEnd && /^sitemap:/.test(line));
    if (at < 0) return NO_CHANGE(text);

    const end = blockEnd(lines, at, fenceEnd);
    const remainder = sitemapRemainder(lines, at, end);
    if (remainder === null) return NO_CHANGE(text); // no opt-out left: already migrated, idempotent

    const stripped = [...lines.slice(0, at), ...remainder, ...lines.slice(end)];
    const out = withMetaIndexFalse(stripped, at + remainder.length, fenceEnd - (end - at) + remainder.length);
    const decided = out === null;

    return {
      text: fromLines(decided ? stripped : out, trailingNewline),
      edits: [{ rule: 'sitemap-index', line: at + 1, before: lines[at].trim(), after: decided ? '' : 'meta: index: false' }],
      findings: [{
        check: 'sitemap-index', line: at + 1, severity: 'warning',
        message: decided
          ? 'dropped the `sitemap` opt-out and kept this page\'s own `meta.index`: there is no "indexable but out of the '
            + 'sitemap" any more, so that flag now decides the robots tag, sitemap.xml, pages.json and llms.txt together. '
            + 'Set `meta.index: false` if the page should stay out'
          : 'the `sitemap` opt-out is `meta.index: false` now: the page is noindex AND out of sitemap.xml, pages.json and '
            + 'llms.txt, one flag for every index. Check the page was meant to leave search too',
      }],
    };
  },
};

module.exports = { appendFlag, sitemapIndex };

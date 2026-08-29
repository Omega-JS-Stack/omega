/**
 * Canonical top-level key order for brand omega.json5 files — "omega
 * reorders the keys so the order is consistent" (Ian), with comments
 * traveling alongside their keys. Applied on every config writeback and
 * exposed standalone.
 *
 * The order is the legacy omega-manager brand-config order extended with
 * the new-world sections. Unknown keys keep their relative order after the
 * known ones. Only the TOP level is ordered — nested layout stays exactly
 * as authored.
 *
 * Loss-proof by construction: the root object's inner region is cut into
 * contiguous TILES, one per top-level entry — each tile runs from the end
 * of the previous entry's last line to the end of its own last line, so
 * leading comment blocks, blank lines, and same-line trailing comments all
 * belong to exactly one tile. Reordering permutes whole tiles and never
 * synthesizes text (beyond trailing commas, which JSON5 allows everywhere).
 * The result must JSON5-parse to data deep-equal to the input or this
 * throws and the caller writes nothing.
 */
const { isDeepStrictEqual } = require('node:util');
const JSON5 = require('json5');

const { parseRoot } = require('./edit.js');

// `targets` goes LAST (Ian 2026-07-14) — it's the per-target override layer,
// so it reads best after every shared section it can override.
// The de-branding rekey (#23) collapsed several vendor-named top-level keys
// into role-shaped homes — `repo`, `edge`, `captcha`, `search`, `forms`,
// `inbound` — and folded `firebase`/`gcp` into `cloud`. Only the TOP level is
// ordered, so each fold is one entry here; the nesting under it is authored.
// Every SHARED_SCHEMA top-level key belongs here — the drift guard in
// test/order.test.js fails the moment the schema grows one this list misses
// (#503: socials, github, directory, ports, client had drifted out), and its
// REVERSE guard fails on a key that is neither schema-known nor a named
// manager-owned block (#484 retired `testing`: no schema rule, and the testing
// service reads no config at all, so converters were carrying a dead key).
const CANONICAL_TOP_LEVEL_ORDER = [
  'enabled', 'parent', 'brand', 'meta', 'company', 'socials', 'account', 'local', 'ports',
  'repo', 'github', 'domain',
  'edge', 'cloud', 'captcha', 'analytics',
  'monitoring', 'advertising', 'payment', 'oauth2', 'sponsorships',
  'marketing', 'blog', 'devlog', 'reviews', 'seo', 'search',
  'dataRequest', 'forms', 'inbound',
  'server', 'assets', 'directory',
  'certificates', 'theme', 'ai', 'translation', 'client', 'migrations', 'targets',
];

/**
 * Reorder a brand omega.json5 source's top-level keys into canonical order,
 * comments riding with their keys. Returns the source unchanged when there
 * is nothing to reorder (or when the file's shape rules out safe tiling —
 * multiple entries on one line).
 *
 * @param {string} source - omega.json5 text (must parse).
 * @returns {string} Reordered source with identical data.
 */
function applyCanonicalOrder(source) {
  const original = JSON5.parse(source);

  // Every entry needs a trailing comma before tiles can be permuted — the
  // original last entry may lack one and would break mid-file. Insert from
  // the end so offsets stay valid, then re-parse.
  let text = source;
  const scan = parseRoot(text);
  if (scan.entries.length < 2) {
    return source;
  }
  const missingCommas = scan.entries
    .filter((entry) => !entry.hasComma)
    .sort((a, b) => b.valueNode.end - a.valueNode.end);
  for (const entry of missingCommas) {
    text = `${text.slice(0, entry.valueNode.end)},${text.slice(entry.valueNode.end)}`;
  }

  const root = parseRoot(text);

  // Prefix: everything through the end of the line the '{' sits on
  const firstNewline = text.indexOf('\n', root.start);
  if (firstNewline === -1) {
    return source; // single-line root — nothing to tile
  }
  const prefixEnd = firstNewline + 1;

  const lineEndAfter = (pos) => {
    const nl = text.indexOf('\n', pos);
    return nl === -1 ? pos : nl + 1;
  };

  const tiles = [];
  let cursor = prefixEnd;
  for (const entry of root.entries) {
    const end = lineEndAfter(entry.commaEnd);
    if (end <= cursor) {
      return source; // two entries share a line — tiling would tear it
    }
    tiles.push({ key: entry.key, text: text.slice(cursor, end) });
    cursor = end;
  }

  // Tail: anything between the last entry's line and the closing brace's
  // line (detached trailing comments) stays where it is
  const braceLineStart = text.lastIndexOf('\n', root.closeStart - 1) + 1;
  const tail = text.slice(cursor, Math.max(cursor, braceLineStart));

  const rank = (key) => {
    // `targets` is last by POLICY — even unknown keys (which rank after the
    // known ones, relative order kept) never sort past it.
    if (key === 'targets') {
      return Number.MAX_SAFE_INTEGER;
    }
    const index = CANONICAL_TOP_LEVEL_ORDER.indexOf(key);
    return index === -1 ? CANONICAL_TOP_LEVEL_ORDER.length : index;
  };
  const ordered = [...tiles].sort((a, b) => rank(a.key) - rank(b.key));

  if (ordered.every((tile, index) => tile === tiles[index]) && text === source) {
    return source; // already canonical, nothing inserted
  }

  const result = text.slice(0, prefixEnd)
    + ordered.map((tile) => tile.text).join('')
    + tail
    + text.slice(Math.max(cursor, braceLineStart));

  let parsed;
  try {
    parsed = JSON5.parse(result);
  } catch (e) {
    throw new Error(`Canonical reorder produced unparseable output — nothing written: ${e.message}`);
  }
  if (!isDeepStrictEqual(parsed, original)) {
    throw new Error('Canonical reorder changed the config data — nothing written');
  }

  return result;
}

module.exports = { applyCanonicalOrder, CANONICAL_TOP_LEVEL_ORDER };

/**
 * The .env line grammar the marker engine merges by and every in-place key
 * writer sets keys by: logical lines (a quoted value spanning several physical
 * lines is one unit), the key a line assigns, the double-quote normalization,
 * and the replace-or-append of a key's lines. dotenv is the reader every OMEGA loader
 * uses, so it is the judge: a normalized line must read back to the same value,
 * and a key's winning line is its LAST one, as dotenv reads it.
 */
const dotenv = require('dotenv');
const { envLine } = require('@omega.js/config');

// An assignment dotenv accepts: optional indent and `export `, then KEY=
const ASSIGNMENT = /^(\s*(?:export\s+)?)([\w.-]+)\s*=(.*)$/s;
const QUOTED_OPEN = /^\s*(?:export\s+)?[\w.-]+\s*=\s*(["'`])/;

/**
 * The index of the quote closing a value opened at `from`, as dotenv picks it:
 * a quote after a backslash may close the value or be passed, the first quote
 * after no backslash cannot be passed, and dotenv takes the LAST closing
 * candidate followed on its line by only whitespace or a `# comment`, so
 * `K="x\"` reads `x\`. -1 when none closes it.
 *
 * @param {string} text
 * @param {string} quote - `"`, `'` or a backtick
 * @param {number} from - First index after the opening quote
 * @returns {number}
 */
function closingQuote(text, quote, from) {
  const lineRest = /[^\S\n]*(?:#[^\n]*)?(?:\n|$)/y;
  let close = -1;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] !== quote) continue;
    lineRest.lastIndex = i + 1;
    if (lineRest.test(text)) close = i;
    if (text[i - 1] !== '\\') break;
  }
  return close;
}

/**
 * Group physical lines into logical ones: a quoted value that closes on a later
 * line joins those lines (newlines kept) into one unit, so it moves and
 * survives whole. An unterminated quote stays line by line, as dotenv reads it.
 *
 * @param {string[]} lines - The file split on `\n`
 * @returns {string[]}
 */
function joinEnvUnits(lines) {
  const units = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i].match(QUOTED_OPEN);
    const rest = open ? lines.slice(i).join('\n') : '';
    const close = open ? closingQuote(rest, open[1], open[0].length) : -1;
    if (close < 0) {
      units.push(lines[i]);
      continue;
    }

    const end = i + rest.slice(0, close).split('\n').length - 1;
    units.push(lines.slice(i, end + 1).join('\n'));
    i = end;
  }
  return units;
}

/**
 * The key a line assigns, or null for a comment, a blank, or anything else.
 *
 * @param {string} line
 * @returns {string|null}
 */
function envKey(line) {
  const match = line.match(ASSIGNMENT);
  return match ? match[2] : null;
}

// The inline comment after a raw value: past the closing quote of a quoted
// value, from the first `#` of an unquoted one.
function trailingComment(raw) {
  let rest = raw;
  if (raw[0] === "'" || raw[0] === '`') {
    const close = closingQuote(raw, raw[0], 1);
    if (close >= 0) rest = raw.slice(close + 1);
  }
  const hash = rest.indexOf('#');
  return hash < 0 ? '' : rest.slice(hash).trim();
}

/**
 * Normalize one .env line to the double-quoted form: `KEY=raw` and `KEY='x'`
 * become `KEY="..."`, an inline comment kept; an empty value becomes `KEY=""`;
 * a double-quoted value, a comment and a blank are left alone. The rewrite
 * happens only when dotenv reads the same value back; otherwise the line stays.
 *
 * @param {string} line - One logical line
 * @returns {string}
 */
function normalizeEnvLine(line) {
  const match = line.match(ASSIGNMENT);
  if (!match) return line;
  const [, prefix, key, rawValue] = match;
  const raw = rawValue.trim();

  if (raw === '') return `${prefix}${key}=""`;
  if (raw.startsWith('"')) return line;

  const value = dotenv.parse(line)[key];
  if (value === undefined) return line;

  let quoted;
  try {
    quoted = envLine(key, value);
  } catch (e) {
    // envLine refuses a value dotenv would read back changed: the line stays
    return line;
  }
  const comment = trailingComment(raw);
  const candidate = `${prefix}${quoted}${comment ? ` ${comment}` : ''}`;
  return dotenv.parse(candidate)[key] === value ? candidate : line;
}

/**
 * The line that sets `key`: the LAST one, the value dotenv reads.
 *
 * @param {string[]} lines
 * @param {string} key
 * @returns {string} - `KEY=""` when no line sets it
 */
function findKeyLine(lines, key) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (envKey(lines[i]) === key) return lines[i];
  }
  return `${key}=""`;
}

// A placeholder, `# KEY=""` or a bare `# KEY=`, → KEY; any other comment → null.
function parsePlaceholderKey(trimmed) {
  const match = trimmed.match(/^#\s*([A-Za-z_][A-Za-z0-9_]*)=\s*(?:"")?\s*$/);
  return match ? match[1] : null;
}

/**
 * Set keys in .env content by logical line: the first unit assigning a key, or
 * its `# KEY=""` placeholder, becomes the given line and every later one drops,
 * so dotenv reads the new value; a key the content never had is appended.
 * Every other line keeps its place.
 *
 * @param {string} content - Current file content ('' for none)
 * @param {Object<string, string>} lineFor - KEY to its whole line, e.g. envLine's
 * @returns {string} The new content, ending in exactly one newline
 */
function setEnvLines(content, lineFor) {
  const body = content.replace(/(?:\r?\n)+$/, '');
  const seen = new Set();

  const out = joinEnvUnits(body === '' ? [] : body.split(/\r?\n/)).flatMap((unit) => {
    const key = envKey(unit) ?? parsePlaceholderKey(unit.trim());
    if (key === null || !Object.hasOwn(lineFor, key)) return [unit];
    if (seen.has(key)) return [];
    seen.add(key);
    return [lineFor[key]];
  });
  for (const key of Object.keys(lineFor)) {
    if (!seen.has(key)) out.push(lineFor[key]);
  }
  return `${out.join('\n')}\n`;
}

// The framework's own .env comment grammar: a boxed group header or a
// `# KEY=""` placeholder. Regenerated from the template, never a consumer's note.
function isMachineComment(trimmed) {
  return /^# ── .* ──$/.test(trimmed) || parsePlaceholderKey(trimmed) !== null;
}

// KEY= / KEY="" / KEY='' (whitespace tolerated) count as empty.
function envValueIsEmpty(line) {
  const eqIdx = line.indexOf('=');
  if (eqIdx < 0) return true;
  const value = line.slice(eqIdx + 1).trim();
  return value === '' || value === '""' || value === "''";
}

module.exports = { joinEnvUnits, envKey, normalizeEnvLine, findKeyLine, parsePlaceholderKey, isMachineComment, envValueIsEmpty, setEnvLines };

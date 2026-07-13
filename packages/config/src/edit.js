/**
 * Comment-preserving omega.json5 edits — the config-writeback engine.
 *
 * Services resolve IDs against external APIs (SendGrid list, Beehiiv
 * publication, payment product IDs, the Firebase SDK config) and write them
 * back into config/omega.json5, the file's ONE authoritative home. The file
 * is human-edited JSON5 — comments, blank lines, key order, and quote style
 * all carry meaning — so writeback is surgical text surgery, not a
 * re-stringify: only the edited value spans change; every other byte
 * survives. (omega-manager's serializer re-stringified the whole config and
 * lost comments; this replaces it outright.)
 *
 * Mechanics: tokenize (strings / punctuation / atoms; comments and
 * whitespace are never tokenized, so they persist implicitly) → recursive
 * descent builds a span tree with absolute offsets → each edit either
 * replaces the leaf's value span or inserts a new property (missing
 * intermediate objects are created inside the inserted text). Edits whose
 * value already matches are skipped entirely, so reruns are byte-identical.
 * After every edit the result must JSON5-parse and carry the requested value
 * at the requested path — any miss throws, so callers can never write a
 * corrupted config.
 *
 * Paths are dot-notation; numeric segments index arrays, and a matcher
 * segment selects an array element by one of its own keys —
 * `payment.products[id=plus].stripe.productId` — so writes self-locate in
 * the file being edited instead of trusting an index computed from a merged
 * config. Array elements are user-authored and never created here. Inserted
 * text uses the house style: unquoted keys, JSON.stringify strings,
 * multi-line objects with trailing commas.
 */

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const JSON5 = require('json5');

const { resolveConfigPath, FILE_NAME } = require('./load.js');

const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MATCHER_SEGMENT = /^([^[]+)\[([A-Za-z0-9_$]+)=([^\]]*)\]$/;
const DEFAULT_INDENT_UNIT = '  ';

/**
 * Parse a dot-path into walk steps. A `name[key=value]` segment expands to a
 * key step plus an array-matcher step.
 * @param {string} path - e.g. 'payment.products[id=plus].stripe.productId'
 * @returns {Array<{ type: 'plain', name: string } | { type: 'match', key: string, value: string }>}
 */
function parsePath(path) {
  const steps = [];
  for (const raw of path.split('.')) {
    const matcher = raw.match(MATCHER_SEGMENT);
    if (matcher) {
      steps.push({ type: 'plain', name: matcher[1] });
      steps.push({ type: 'match', key: matcher[2], value: matcher[3] });
    } else {
      steps.push({ type: 'plain', name: raw });
    }
  }
  return steps;
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

/**
 * Tokenize JSON5 source into structural tokens with absolute spans.
 * Comments and whitespace produce no tokens — edits splice around them.
 * @param {string} source - JSON5 text (already known to parse).
 * @returns {Array<{ type: string, start: number, end: number }>}
 */
function tokenize(source) {
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      const lineEnd = source.indexOf('\n', i);
      i = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      const blockEnd = source.indexOf('*/', i + 2);
      i = blockEnd === -1 ? source.length : blockEnd + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === ch) {
          i += 1;
          break;
        }
        i += 1;
      }
      tokens.push({ type: 'string', start, end: i });
      continue;
    }

    if ('{}[]:,'.includes(ch)) {
      tokens.push({ type: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    const start = i;
    while (i < source.length && !/[\s{}[\]:,'"/]/.test(source[i])) {
      i += 1;
    }
    tokens.push({ type: 'atom', start, end: i });
  }

  return tokens;
}

// ─── Span-tree parser ────────────────────────────────────────────────────────

/**
 * Decode a key token to its property name ('brand' from brand, 'a b' from 'a b').
 */
function decodeKey(source, token) {
  const text = source.slice(token.start, token.end);
  return token.type === 'string' ? JSON5.parse(text) : text;
}

/**
 * Recursive descent over tokens; returns { node, next }. Nodes carry
 * absolute spans: objects list entries (key span, value node, trailing
 * comma), arrays list item nodes, primitives are a single span.
 */
function parseValue(source, tokens, index) {
  const token = tokens[index];

  if (!token) {
    throw new Error('Unexpected end of config while parsing');
  }

  if (token.type === '{') {
    const node = { kind: 'object', start: token.start, end: null, closeStart: null, entries: [] };
    let i = index + 1;

    while (tokens[i] && tokens[i].type !== '}') {
      const keyToken = tokens[i];
      if (keyToken.type !== 'atom' && keyToken.type !== 'string') {
        throw new Error(`Expected object key at offset ${keyToken.start}`);
      }
      if (tokens[i + 1]?.type !== ':') {
        throw new Error(`Expected ':' after key at offset ${keyToken.start}`);
      }

      const { node: valueNode, next } = parseValue(source, tokens, i + 2);
      const entry = { key: decodeKey(source, keyToken), keyStart: keyToken.start, valueNode, hasComma: false, commaEnd: valueNode.end };
      i = next;

      if (tokens[i]?.type === ',') {
        entry.hasComma = true;
        entry.commaEnd = tokens[i].end;
        i += 1;
      }
      node.entries.push(entry);
    }

    if (!tokens[i]) {
      throw new Error('Unclosed object in config');
    }
    node.closeStart = tokens[i].start;
    node.end = tokens[i].end;
    return { node, next: i + 1 };
  }

  if (token.type === '[') {
    const node = { kind: 'array', start: token.start, end: null, closeStart: null, items: [] };
    let i = index + 1;

    while (tokens[i] && tokens[i].type !== ']') {
      const { node: itemNode, next } = parseValue(source, tokens, i);
      node.items.push(itemNode);
      i = next;
      if (tokens[i]?.type === ',') {
        i += 1;
      }
    }

    if (!tokens[i]) {
      throw new Error('Unclosed array in config');
    }
    node.closeStart = tokens[i].start;
    node.end = tokens[i].end;
    return { node, next: i + 1 };
  }

  if (token.type === 'string' || token.type === 'atom') {
    return { node: { kind: 'primitive', start: token.start, end: token.end }, next: index + 1 };
  }

  throw new Error(`Unexpected token '${token.type}' at offset ${token.start}`);
}

/**
 * Parse the root object of a config source into a span tree.
 */
function parseRoot(source) {
  const tokens = tokenize(source);
  const { node } = parseValue(source, tokens, 0);
  if (node.kind !== 'object') {
    throw new Error('Config root must be an object');
  }
  return node;
}

// ─── House-style serializer (inserted text only) ─────────────────────────────

/**
 * Serialize a key in house style — unquoted when identifier-safe.
 */
function serializeKey(key) {
  return IDENTIFIER_KEY.test(key) ? key : JSON.stringify(key);
}

/**
 * Serialize a value for insertion. `indent` is the indentation of the line
 * the value starts on; nested lines add `unit` per depth.
 */
function serializeValue(value, indent, unit) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const allPrimitives = value.every((item) => item === null || typeof item !== 'object');
    if (allPrimitives) {
      return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    }
    const inner = indent + unit;
    const lines = value.map((item) => `${inner}${serializeValue(item, inner, unit)},`);
    return `[\n${lines.join('\n')}\n${indent}]`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return '{}';
  }
  const inner = indent + unit;
  const lines = entries.map(([key, entry]) => `${inner}${serializeKey(key)}: ${serializeValue(entry, inner, unit)},`);
  return `{\n${lines.join('\n')}\n${indent}}`;
}

/**
 * Single-line serialization for insertions into single-line objects —
 * `{ id: 'plus' }` gains `stripe: { productId: "prod_X" }` without exploding
 * into a block mid-line.
 */
function serializeValueInline(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeValueInline).join(', ')}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return '{}';
  }
  return `{ ${entries.map(([key, entry]) => `${serializeKey(key)}: ${serializeValueInline(entry)}`).join(', ')} }`;
}

/**
 * Nest the remaining key names into an object so a whole missing branch
 * inserts as one property (marketing → { campaigns: { listId: value } }).
 */
function nestValue(names, value) {
  return names.reduceRight((acc, name) => ({ [name]: acc }), value);
}

// ─── Layout helpers ──────────────────────────────────────────────────────────

/**
 * The whitespace indentation of the line containing `pos`.
 */
function lineIndentAt(source, pos) {
  const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
  const match = source.slice(lineStart, pos).match(/^[ \t]*/);
  return match ? match[0] : '';
}

/**
 * Detect the file's indent unit from its first indented line ('  ' default).
 */
function detectIndentUnit(source) {
  const match = source.match(/\n([ \t]+)\S/);
  return match ? match[1] : DEFAULT_INDENT_UNIT;
}

// ─── Single-edit application ─────────────────────────────────────────────────

/**
 * Insert a missing property (possibly a nested branch) into an object node.
 * The remaining steps must all be plain keys — a matcher below a missing key
 * would mean creating an array element, which writeback never does.
 * Returns the new source.
 */
function insertProperty(source, node, path, steps, value, unit) {
  if (steps.some((step) => step.type !== 'plain')) {
    throw new Error(`Cannot set '${path}': the branch is missing and a [key=value] matcher cannot create array elements`);
  }

  const names = steps.map((step) => step.name);
  const key = serializeKey(names[0]);
  const nested = nestValue(names.slice(1), value);

  // Empty object with nothing but whitespace inside → rewrite as a block
  const innerText = source.slice(node.start + 1, node.closeStart);
  if (node.entries.length === 0 && /^\s*$/.test(innerText)) {
    const closeIndent = lineIndentAt(source, node.start);
    const childIndent = closeIndent + unit;
    const block = `{\n${childIndent}${key}: ${serializeValue(nested, childIndent, unit)},\n${closeIndent}}`;
    return source.slice(0, node.start) + block + source.slice(node.end);
  }

  const isSingleLine = !source.slice(node.start, node.end).includes('\n');

  if (isSingleLine) {
    if (node.entries.length > 0) {
      // { a: 1 } → { a: 1, key: value }
      const last = node.entries[node.entries.length - 1];
      const insertion = `, ${key}: ${serializeValueInline(nested)}`;
      return source.slice(0, last.valueNode.end) + insertion + source.slice(last.valueNode.end);
    }
    // No entries but comments inside (whitespace-only was rewritten above)
    const insertion = `${key}: ${serializeValueInline(nested)} `;
    return source.slice(0, node.closeStart) + insertion + source.slice(node.closeStart);
  }

  // Multi-line object: new property goes on its own line, right before the
  // closing brace's line, so trailing comments stay with what they document.
  const braceLineStart = source.lastIndexOf('\n', node.closeStart - 1) + 1;
  const childIndent = node.entries.length > 0
    ? lineIndentAt(source, node.entries[0].keyStart)
    : lineIndentAt(source, node.closeStart) + unit;
  const propertyLine = `${childIndent}${key}: ${serializeValue(nested, childIndent, unit)},\n`;

  let result = source.slice(0, braceLineStart) + propertyLine + source.slice(braceLineStart);

  // The previous last entry needs a trailing comma to stay parseable
  const last = node.entries[node.entries.length - 1];
  if (last && !last.hasComma) {
    result = result.slice(0, last.valueNode.end) + ',' + result.slice(last.valueNode.end);
  }

  return result;
}

/**
 * True when an object item node carries `key: value` where value is a
 * primitive whose parsed form stringifies to the matcher's value.
 */
function matchesElement(source, item, step) {
  if (item.kind !== 'object') {
    return false;
  }
  const entry = [...item.entries].reverse().find((candidate) => candidate.key === step.key);
  if (!entry || entry.valueNode.kind !== 'primitive') {
    return false;
  }
  return String(JSON5.parse(source.slice(entry.valueNode.start, entry.valueNode.end))) === step.value;
}

/**
 * Apply one dot-path edit to the source. Walks the span tree; replaces the
 * leaf's value span when the path exists, inserts the missing branch when it
 * doesn't. Throws when an intermediate value isn't a container, an array
 * index is out of range, or a [key=value] matcher finds no element.
 */
function applySingleEdit(source, path, value) {
  const steps = parsePath(path);
  const unit = detectIndentUnit(source);
  let node = parseRoot(source);

  const replaceSpan = (target, indent) =>
    source.slice(0, target.start) + serializeValue(value, indent, unit) + source.slice(target.end);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isLast = i === steps.length - 1;
    const walked = steps.slice(0, i)
      .map((prior) => (prior.type === 'match' ? `[${prior.key}=${prior.value}]` : prior.name))
      .join('.') || '(root)';

    if (step.type === 'match') {
      if (node.kind !== 'array') {
        throw new Error(`Cannot set '${path}': a [${step.key}=${step.value}] matcher needs an array`);
      }
      const item = node.items.find((candidate) => matchesElement(source, candidate, step));
      if (!item) {
        throw new Error(`Cannot set '${path}': no array element with ${step.key}=${step.value} (elements are never created by writeback)`);
      }
      if (isLast) {
        return replaceSpan(item, lineIndentAt(source, item.start));
      }
      node = item;
      continue;
    }

    if (node.kind === 'array') {
      if (!/^\d+$/.test(step.name)) {
        throw new Error(`Cannot set '${path}': '${walked}' is an array (expected a numeric index or [key=value] matcher, got '${step.name}')`);
      }
      const item = node.items[Number(step.name)];
      if (!item) {
        throw new Error(`Cannot set '${path}': index ${step.name} is out of range (array elements are never created by writeback)`);
      }
      if (isLast) {
        return replaceSpan(item, lineIndentAt(source, item.start));
      }
      node = item;
      continue;
    }

    if (node.kind !== 'object') {
      throw new Error(`Cannot set '${path}': '${walked}' is not an object`);
    }

    // Duplicate keys: JSON5 keeps the last one, so edit the last one
    const entry = [...node.entries].reverse().find((candidate) => candidate.key === step.name);

    if (!entry) {
      return insertProperty(source, node, path, steps.slice(i), value, unit);
    }

    if (isLast) {
      return replaceSpan(entry.valueNode, lineIndentAt(source, entry.keyStart));
    }

    node = entry.valueNode;
  }

  throw new Error(`Cannot set '${path}': empty path`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Read a dot-path from a parsed config (numeric segments index arrays,
 * [key=value] matchers select array elements).
 */
function getAtPath(parsed, path) {
  let current = parsed;
  for (const step of parsePath(path)) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (step.type === 'match') {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current.find((element) => element && typeof element === 'object' && String(element[step.key]) === step.value);
    } else {
      current = current[step.name];
    }
  }
  return current;
}

/**
 * The subset of edits whose target path doesn't already hold the value —
 * the skip that makes reruns byte-identical.
 */
function pendingEdits(parsed, edits) {
  return Object.entries(edits).filter(([path, value]) => !isDeepStrictEqual(getAtPath(parsed, path), value));
}

/**
 * Apply dot-path edits to JSON5 source text, preserving every byte outside
 * the edited spans. Verifies its own output: the result must parse and hold
 * each requested value, or this throws and nothing is returned.
 *
 * @param {string} source - omega.json5 text.
 * @param {Object<string, *>} edits - Dot-path → value (JSON-serializable).
 * @returns {string} The edited source.
 */
function applyConfigEdits(source, edits) {
  let current = source;
  let parsed = JSON5.parse(source);

  for (const [path, value] of pendingEdits(parsed, edits)) {
    current = applySingleEdit(current, path, value);
    try {
      parsed = JSON5.parse(current);
    } catch (e) {
      throw new Error(`Config edit '${path}' produced unparseable output — nothing written: ${e.message}`);
    }
  }

  for (const [path, value] of Object.entries(edits)) {
    if (!isDeepStrictEqual(getAtPath(parsed, path), value)) {
      throw new Error(`Config edit '${path}' did not land — nothing written`);
    }
  }

  return current;
}

/**
 * Apply edits to a project's omega.json5 on disk. Resolves the file via the
 * standard locations, skips the write entirely when nothing changes, and
 * reports which paths were actually edited. `dryRun` computes everything
 * (including the full edit + verification) but never writes.
 *
 * @param {string} projectDir - Project root (brand root in a brand monorepo).
 * @param {Object<string, *>} edits - Dot-path → value.
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{ path: string, changed: boolean, applied: string[] }}
 */
function writeConfigValues(projectDir, edits, { dryRun = false } = {}) {
  const configPath = resolveConfigPath(projectDir);
  if (!configPath) {
    throw new Error(`No ${FILE_NAME} found under ${projectDir} — cannot write config values`);
  }

  const source = fs.readFileSync(configPath, 'utf8');
  const applied = pendingEdits(JSON5.parse(source), edits).map(([path]) => path);
  // Every writeback also normalizes top-level key order (comments travel
  // with their keys) — lazy require: order.js depends on this module
  const { applyCanonicalOrder } = require('./order.js');
  const next = applyCanonicalOrder(applyConfigEdits(source, edits));

  if (next !== source && !dryRun) {
    fs.writeFileSync(configPath, next);
  }

  return { path: configPath, changed: next !== source, applied };
}

module.exports = { applyConfigEdits, writeConfigValues, parseRoot };

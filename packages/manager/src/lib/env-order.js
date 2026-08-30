/**
 * Canonical .env ordering — the .env sibling of @omega.js/config's
 * applyCanonicalOrder (cp137, Ian: "reorder our env files like the config
 * files... moving comments too?").
 *
 * The grouping, the group comments, and the key inventory all live in
 * @omega.js/config's env schema (#581): canonicalEnvGroups() is that schema
 * rendered as .env sections, the scaffold stub renders from it and every
 * reorder renders from it, so a freshly scaffolded .env and a years-old
 * converged one have the same shape — and a key the composer knows can never
 * be missing from the stub, because both derive from the same entries.
 *
 * Machine-owned comments — the boxed `# ── … ──`
 * group headers, `# KEY=` placeholders, the SSOT note lines — are
 * REGENERATED on every render (stale text self-heals); hand-written
 * comments travel verbatim with the key directly below them; the file's
 * leading comment block stays at the top as the header. Unknown keys keep
 * their relative order in an "Other" section after the known groups.
 *
 * Duplicate keys collapse to the LAST occurrence — dotenv.parse's winner,
 * so the effective value can never change — and hand comments from dropped
 * occurrences move to the kept one.
 *
 * Loss-proof by construction: a structural pre-check accepts only comment /
 * blank / KEY=value lines (anything else — multi-line quoted values,
 * `export` forms — declines untouched), kept lines are carried VERBATIM,
 * and a key→value equality post-check (last-wins, both sides) refuses to
 * return a reorder that changed any effective value.
 */

const { envFileGroups, envKeysByGroup, envLine } = require('@omega.js/config');

/**
 * The canonical .env sections: every schema group that renders into a file,
 * in schema order, with its keys. Derived on every call so a key added to the
 * schema needs no edit here (and the group's own `notes` travel with it).
 *
 * @returns {Array<{comment: string, notes?: string[], keys: string[]}>}
 */
function canonicalEnvGroups() {
  const byGroup = envKeysByGroup();

  return envFileGroups()
    .map((group) => ({ comment: group.comment, notes: group.notes, keys: byGroup[group.id] || [] }))
    .filter((group) => group.keys.length > 0);
}

const OTHER_COMMENT = 'Other keys (not in the canonical groups)';

// Machine-owned comment lines are regenerated from the SSOT on every render,
// so the parser drops them: boxed group headers (current or stale text),
// `# KEY=` placeholders, the groups' own note lines, and the legacy scaffold
// trailer (pre-cp137 stubs mentioned the auto-generated keys in prose).
const MACHINE_COMMENT_PATTERNS = [
  /^# ── .* ──$/,
  /^# [A-Za-z_][A-Za-z0-9_]*=$/,
];
const MACHINE_COMMENT_EXACT = [
  '# Auto-generated and persisted here on the first real run — leave unset:',
  '# ACCOUNT_PASSWORD_SEED, CSC_KEY_PASSWORD',
];

function isMachineComment(line, groups) {
  return MACHINE_COMMENT_EXACT.includes(line)
    || groups.some((group) => (group.notes || []).some((note) => `# ${note}` === line))
    || MACHINE_COMMENT_PATTERNS.some((pattern) => pattern.test(line));
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/**
 * Parse a simple .env file into header, keyed entries, and stray comment
 * blocks. Returns { unparseable: reason } when any line is neither a
 * comment, blank, nor single-line KEY=value — the caller declines to
 * reorder rather than risk a legal-but-exotic dotenv construct.
 */
function parseEnvFile(content) {
  const groups = canonicalEnvGroups();
  const header = [];
  const entries = new Map(); // key → { raw, handComments: string[], order }
  const strays = [];
  let pending = [];
  let sawKey = false;
  let order = 0;

  const flushStandalone = () => {
    if (pending.length === 0) return;
    if (!sawKey && header.length === 0) {
      header.push(...pending);
    } else {
      strays.push(pending);
    }
    pending = [];
  };

  const lines = content.split('\n');
  // A trailing newline yields one empty last element — structural, not a line
  if (lines[lines.length - 1] === '') lines.pop();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      flushStandalone();
      continue;
    }
    if (line.trimStart().startsWith('#')) {
      if (!isMachineComment(line, groups)) pending.push(line);
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (!match) {
      return { unparseable: `line ${i + 1} is not a comment, blank, or single-line KEY=value` };
    }
    sawKey = true;
    const key = match[1];
    const existing = entries.get(key);
    if (existing) {
      // Last occurrence wins (dotenv.parse semantics) — its raw line is
      // kept verbatim; hand comments from every occurrence merge onto it
      existing.raw = line;
      existing.handComments.push(...pending);
    } else {
      entries.set(key, { raw: line, handComments: pending, order: order++ });
    }
    pending = [];
  }
  flushStandalone();

  return { header, entries, strays };
}

/**
 * Render the canonical .env layout: header, every group (real lines
 * verbatim where present, `# KEY=` placeholders otherwise), then unknown
 * keys and stray comment blocks under an "Other" section.
 *
 * @param {object} input
 * @param {string[]} [input.header] - Verbatim comment lines for the top.
 * @param {Map<string, {raw: string, handComments?: string[]}>|object} [input.entries] -
 *   key → entry; `raw` is the exact line to emit for that key.
 * @param {Array<string[]>} [input.strays] - Standalone comment blocks.
 * @returns {string} File content, trailing newline included.
 */
function renderCanonicalEnv({ header = [], entries = new Map(), strays = [] } = {}) {
  const entryMap = entries instanceof Map ? entries : new Map(Object.entries(entries));
  const groups = canonicalEnvGroups();
  const knownKeys = new Set(groups.flatMap((group) => group.keys));
  const out = [];

  if (header.length > 0) {
    out.push(...header, '');
  }

  for (const group of groups) {
    out.push(`# ── ${group.comment} ──`);
    for (const note of group.notes || []) {
      out.push(`# ${note}`);
    }
    for (const key of group.keys) {
      const entry = entryMap.get(key);
      if (entry) {
        out.push(...(entry.handComments || []), entry.raw);
      } else {
        out.push(`# ${key}=`);
      }
    }
    out.push('');
  }

  const unknown = [...entryMap.entries()]
    .filter(([key]) => !knownKeys.has(key))
    .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));
  if (unknown.length > 0 || strays.length > 0) {
    out.push(`# ── ${OTHER_COMMENT} ──`);
    for (const [, entry] of unknown) {
      out.push(...(entry.handComments || []), entry.raw);
    }
    for (const block of strays) {
      out.push(...block);
    }
    out.push('');
  }

  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

/** key → verbatim value string, last occurrence wins — the equality probe. */
function effectiveValues(content) {
  const values = new Map();
  for (const line of content.split('\n')) {
    const match = KEY_LINE.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

/**
 * Reorder .env content into the canonical layout, loss-proof.
 *
 * @param {string} content - Current file content.
 * @param {object} [options]
 * @param {string[]} [options.defaultHeader] - Header comment lines used only
 *   when the file has none of its own.
 * @returns {{ content: string, changed: boolean, skipped?: string, duplicatesCollapsed?: number }}
 *   `skipped` names why the content was left untouched (unrecognized
 *   structure, or the paranoia check tripping).
 */
function applyEnvOrder(content, { defaultHeader = [] } = {}) {
  const parsed = parseEnvFile(content);
  if (parsed.unparseable) {
    return { content, changed: false, skipped: parsed.unparseable };
  }

  const keyLineCount = content.split('\n').filter((line) => KEY_LINE.test(line)).length;
  const duplicatesCollapsed = keyLineCount - parsed.entries.size;

  const rendered = renderCanonicalEnv({
    header: parsed.header.length > 0 ? parsed.header : defaultHeader,
    entries: parsed.entries,
    strays: parsed.strays,
  });

  // Paranoia post-check: every key's effective value must survive verbatim
  const before = effectiveValues(content);
  const after = effectiveValues(rendered);
  if (before.size !== after.size || [...before].some(([key, value]) => after.get(key) !== value)) {
    return { content, changed: false, skipped: 'reorder would change effective values (bug guard)' };
  }

  return { content: rendered, changed: rendered !== content, duplicatesCollapsed };
}

// `envLine` is @omega.js/config's serializer, re-exported so the manager's
// writebacks keep one import — the escaping rules live there, with the
// composer that has to read them back.
module.exports = { canonicalEnvGroups, envLine, renderCanonicalEnv, applyEnvOrder };

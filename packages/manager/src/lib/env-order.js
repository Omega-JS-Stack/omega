/**
 * The brand and company `.env` template, and the ONE converge every writer
 * runs it through: devkit's marker engine (`@omega.js/devkit/merge-line-files`).
 * The template is the Default section: a header, then every env-schema group
 * under its boxed comment, each key a `# KEY=""` placeholder unless a value is
 * passed; the Custom section is its bare marker. The engine rewrites Default
 * (a set value kept on its key's line), keeps Custom verbatim, and moves a key
 * the template does not know under Custom with its value. A guard makes it
 * loss-proof: the effective values dotenv reads (the loader's reader; an empty
 * value never claims a key) must match before and after, or the file is left
 * as it was and the caller is told why.
 */

const dotenv = require('dotenv');
const { mergeLineBasedFiles, DEFAULT_MARKER, CUSTOM_MARKER } = require('@omega.js/devkit/merge-line-files');
const { envFileGroups, envKeysByGroup, envLine } = require('@omega.js/config');

// One header for the brand and the company file alike, so a writer never
// needs to know which of the two it holds.
const HEADER = [
  '# Secrets: gitignored, loaded before every omega run. The shell wins over a',
  '# brand .env, and a brand .env wins over its company .env. Uncomment and fill',
  '# what you use: a service without its credentials skips cleanly.',
];

/**
 * The canonical .env sections: every schema group that renders into a file,
 * in schema order, with its keys.
 *
 * @returns {Array<{comment: string, notes?: string[], keys: string[]}>}
 */
function canonicalEnvGroups() {
  const byGroup = envKeysByGroup();

  return envFileGroups()
    .map((group) => ({ comment: group.comment, notes: group.notes, keys: byGroup[group.id] || [] }))
    .filter((group) => group.keys.length > 0);
}

/**
 * Render the marker template: the Default section (header, every group, a
 * placeholder per key or its `KEY="value"` line when `values` sets it), then
 * the bare Custom marker.
 *
 * @param {Object<string, string>} [values] - Keys to render set, e.g. the
 *   scaffold's freshly minted generated keys.
 * @returns {string} File content, trailing newline included.
 */
function renderEnvTemplate(values = {}) {
  const out = [DEFAULT_MARKER, ...HEADER, ''];

  for (const group of canonicalEnvGroups()) {
    out.push(`# ── ${group.comment} ──`);
    for (const note of group.notes || []) {
      out.push(`# ${note}`);
    }
    for (const key of group.keys) {
      out.push(key in values ? envLine(key, values[key]) : `# ${key}=""`);
    }
    out.push('');
  }

  out.push(CUSTOM_MARKER);
  return `${out.join('\n')}\n`;
}

/** The values the loader sees: dotenv's parse, empty values dropped. */
function effectiveValues(content) {
  return Object.entries(dotenv.parse(content)).filter(([, value]) => value !== '');
}

/**
 * Converge .env content onto the marker template through the marker engine.
 *
 * @param {string} content - Current file content ('' for no file).
 * @returns {{ content: string, changed: boolean, skipped?: string }} `skipped`
 *   names why the content was left untouched.
 */
function convergeEnv(content) {
  let merged = mergeLineBasedFiles(content, renderEnvTemplate(), '.env');
  if (!merged.endsWith('\n')) merged += '\n';

  const before = new Map(effectiveValues(content));
  const after = effectiveValues(merged);
  if (before.size !== after.length || after.some(([key, value]) => before.get(key) !== value)) {
    return { content, changed: false, skipped: 'converging would change an effective value' };
  }

  return { content: merged, changed: merged !== content };
}

module.exports = { renderEnvTemplate, convergeEnv };

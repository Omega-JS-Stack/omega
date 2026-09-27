/**
 * brand-config.js: the web leg's config step inside a brand. The brand root's
 * config/omega.json5 is the one home of the conversion, so the converted legacy
 * config merges into it through config's comment-preserving writer: an existing
 * root value always wins, and what only a web load declares lands under
 * `targets.<name>`, the target's real folder name. A target's own
 * config/omega.json5 is its override layer and is never read or written here.
 */
const fs = require('node:fs');
const JSON5 = require('json5');
const { applyConfigEdits, writeConfigFileValues, undeclaredAuthoredPaths, planMerge, setAtPath } = require('@omega.js/config');
const { removePath } = require('./config-convert.js');

/**
 * The converted config in the brand root's shape: the keys a brand root's
 * shared layer declares stay at the top, and every other top-level path joins
 * the target's own entry under `targets.<name>`.
 * @param {object} converted - convertConfig's omega, keyed by `name`.
 * @param {string} name - The target's folder name.
 * @returns {object}
 */
function brandShape(converted, name) {
  const { targets, ...shared } = structuredClone(converted);
  const entry = targets[name];

  for (const dotted of undeclaredAuthoredPaths(shared)) {
    const steps = dotted.split('.');
    setAtPath(entry, dotted, steps.reduce((node, key) => node[key], shared));
    removePath(shared, steps);
  }

  return { ...shared, targets: { [name]: entry } };
}

/**
 * Merge a web target's converted config into its brand root's
 * config/omega.json5. Only `execute` touches the disk.
 * @param {string} brandFile - The brand root's config/omega.json5.
 * @param {object} options
 * @param {string} options.name - The target's folder name, its key under `targets`.
 * @param {object} options.converted - convertConfig's omega, keyed by `name`.
 * @param {boolean} options.execute
 * @returns {{ file: string, added: object[], kept: object[], text: string }}
 */
function mergeIntoBrand(brandFile, { name, converted, execute }) {
  const source = fs.readFileSync(brandFile, 'utf8');
  const { added, kept } = planMerge(brandShape(converted, name), JSON5.parse(source));
  const edits = Object.fromEntries(added.map((entry) => [entry.path, entry.value]));
  if (execute && added.length > 0) writeConfigFileValues(brandFile, edits);

  return { file: brandFile, added, kept, text: applyConfigEdits(source, edits) };
}

module.exports = { mergeIntoBrand };

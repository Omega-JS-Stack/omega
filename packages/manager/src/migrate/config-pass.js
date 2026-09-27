/**
 * The config pass of `omega migrate`: the ONE place a brand's authored omega
 * files are judged, the same files the loader validates. Each one gets the
 * retired rows (a `convert` row moves its value, never over one already
 * authored), then every key the strict schema still refuses that no row
 * covers, as a by-hand line. Writes only under `execute`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const JSON5 = require('json5');

const { ENV_ENVIRONMENTS, FILE_NAME, overlayPath, TARGETS, removeConfigFileValues, writeConfigFileValues, undeclaredAuthoredPaths } = require('@omega.js/config');
const { findRetiredKeys } = require('./retired-keys.js');

/**
 * One layer's omega files, present or not: its base, then one overlay per environment.
 * @param {string} dir - The layer's config/ dir.
 * @returns {string[]}
 */
function layerFiles(dir) {
  const base = path.join(dir, FILE_NAME);
  return [base, ...ENV_ENVIRONMENTS.map((environment) => overlayPath(base, environment))];
}

/**
 * Every authored omega file of a brand: its base file and the environment
 * overlays beside it, then each framework target's own file and overlays.
 * @param {string} baseFile - The brand's config/omega.json5.
 * @param {Array<object>} targets - discoverTargets entries.
 * @returns {Array<{ file: string, target?: string }>}
 */
function authoredConfigFiles(baseFile, targets) {
  const layer = (dir, target) => layerFiles(dir)
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, target }));

  return [
    ...layer(path.dirname(baseFile)),
    ...targets.filter((entry) => TARGETS.includes(entry.target)).flatMap((entry) => layer(path.join(entry.path, 'config'), entry.target)),
  ];
}

/**
 * The pass over one file, as the line lists every migrate block answers with.
 * @param {{ file: string, target?: string }} authored - The file, and the type
 *   of the target it belongs to (a target's own file is that target's layer).
 * @param {boolean} execute
 * @returns {{ due: string[], changed: string[], errors: string[], undeclared: number }}
 */
function migrateConfigFile({ file, target }, execute) {
  const result = { due: [], changed: [], errors: [], undeclared: 0 };
  let config;

  try {
    config = JSON5.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    result.errors.push(`does not parse, fix the syntax first: ${e.message}`);
    return result;
  }

  // One finding per key, in file order: a key that is both a retired NAME and
  // a retired PATH is one property to delete either way.
  const findings = [];
  for (const finding of findRetiredKeys(config)) {
    if (!findings.some((seen) => seen.path === finding.path)) findings.push(finding);
  }

  const conversions = [];
  const refused = new Set();

  for (const finding of findings) {
    if (typeof finding.convert !== 'function') {
      (execute ? result.changed : result.due).push(`${execute ? 'removed' : 'remove'} ${finding.path} → ${finding.replacement}: ${finding.why}`);
      continue;
    }

    // A brand that started the move by hand carries both keys: the row is
    // refused whole, so the converted old setting never replaces the new one.
    const to = convertedPath(finding);
    const value = finding.convert(valueAt(config, finding.path));
    const present = valueAt(config, to);
    if (present !== undefined && !isDeepStrictEqual(present, value)) {
      refused.add(finding);
      result.errors.push(`refused ${finding.path} → ${to}: ${to} is already authored here = ${JSON.stringify(present)}; both settings are in this file: delete one of the two by hand, then run \`omega migrate --execute\` again`);
      continue;
    }

    conversions.push({ path: to, value });
    (execute ? result.changed : result.due).push(`${execute ? 'moved' : 'move'} ${finding.path} → ${to} = ${JSON.stringify(value)}: ${finding.why}`);
  }

  if (execute) {
    // Conversions FIRST: the new key is written while the old one is still there
    if (conversions.length) writeConfigFileValues(file, Object.fromEntries(conversions.map((entry) => [entry.path, entry.value])));
    removeConfigFileValues(file, findings.filter((finding) => !refused.has(finding)).map((finding) => finding.path));
    config = JSON5.parse(fs.readFileSync(file, 'utf8'));
  }

  // Judged after converting, so the residue is what the brand still owes; a
  // path a reported row covers is that row's line, never a second one
  const covered = findings.filter((finding) => !execute || refused.has(finding)).map((finding) => finding.path);
  const residue = undeclaredAuthoredPaths(config, { target })
    .filter((dotted) => !covered.some((row) => dotted === row || dotted.startsWith(`${row}.`)));
  result.due.push(...residue.map((dotted) => `config.${dotted} is not a key the schema declares; remove it by hand`));
  result.undeclared = residue.length;

  return result;
}

/**
 * Where a converted setting lands: the retired path with its LAST segment
 * replaced by the replacement's, so a row registered at `targets.web.…` writes
 * back into the target the brand wrote it in.
 * @param {{ path: string, replacement: string }} finding
 * @returns {string}
 */
function convertedPath(finding) {
  const steps = finding.path.split('.');
  steps[steps.length - 1] = finding.replacement.split('.').pop();

  return steps.join('.');
}

/**
 * Read a dot-path off the parsed config. The path came from the walk that
 * found it, so every step exists.
 * @param {object} config
 * @param {string} dotted
 * @returns {*}
 */
function valueAt(config, dotted) {
  return dotted.split('.').reduce((node, key) => (node == null ? undefined : node[key]), config);
}

module.exports = { layerFiles, authoredConfigFiles, migrateConfigFile };

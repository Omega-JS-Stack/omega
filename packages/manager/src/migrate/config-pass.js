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

const { ENV_ENVIRONMENTS, FILE_NAME, overlayPath, seoSidecarPath, TARGETS, removeConfigFileValues, writeConfigFileValues, undeclaredAuthoredPaths, pathSteps, spellSteps } = require('@omega.js/config');
const { findRetiredKeys, ConvertRefused } = require('./retired-keys.js');

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
 * overlays beside it, the `config/seo.json5` sidecar (its root is the `seo`
 * section), then each framework target's own file and overlays.
 * @param {string} baseFile - The brand's config/omega.json5.
 * @param {Array<object>} targets - discoverTargets entries.
 * @returns {Array<{ file: string, target?: string, section?: string }>}
 */
function authoredConfigFiles(baseFile, targets) {
  const layer = (dir, target) => layerFiles(dir)
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, target }));
  const seoFile = seoSidecarPath(baseFile);

  return [
    ...layer(path.dirname(baseFile)),
    ...(fs.existsSync(seoFile) ? [{ file: seoFile, section: 'seo' }] : []),
    ...targets.filter((entry) => TARGETS.includes(entry.target)).flatMap((entry) => layer(path.join(entry.path, 'config'), entry.target)),
  ];
}

/**
 * One authored file parsed from the config's root: a section file's own root
 * is that section, so its keys sit under it.
 * @param {{ file: string, section?: string }} authored - An authoredConfigFiles entry.
 * @returns {object}
 */
function readAuthoredConfig({ file, section }) {
  const parsed = JSON5.parse(fs.readFileSync(file, 'utf8'));
  return section ? { [section]: parsed } : parsed;
}

/**
 * The pass over one file, as the line lists every migrate block answers with.
 * Paths are judged and reported from the config's root, so a section file's
 * own root is that section.
 * @param {{ file: string, target?: string, section?: string }} authored - The
 *   file, the type of the target it belongs to (a target's own file is that
 *   target's layer), and the section a sidecar's root is.
 * @param {boolean} execute
 * @returns {{ due: string[], changed: string[], errors: string[], undeclared: number }}
 */
function migrateConfigFile({ file, target, section }, execute) {
  const result = { due: [], changed: [], errors: [], undeclared: 0 };
  const read = () => readAuthoredConfig({ file, section });
  const inFile = (spelled) => (section ? spellSteps(pathSteps(spelled).slice(1)) : spelled);
  let config;

  try {
    config = read();
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
    let value;
    try {
      value = finding.convert(valueAt(config, finding.path));
    } catch (e) {
      if (!(e instanceof ConvertRefused)) throw e;
      refused.add(finding);
      result.errors.push(`refused ${finding.path}: ${e.message}`);
      continue;
    }
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
    if (conversions.length) writeConfigFileValues(file, Object.fromEntries(conversions.map((entry) => [inFile(entry.path), entry.value])));
    removeConfigFileValues(file, findings.filter((finding) => !refused.has(finding)).map((finding) => inFile(finding.path)));
    config = read();
  }

  // Judged after converting, so the residue is what the brand still owes; a
  // path a reported row covers is that row's line, never a second one
  const covered = findings.filter((finding) => !execute || refused.has(finding)).map((finding) => finding.path);
  const residue = undeclaredAuthoredPaths(config, { target })
    .filter((spelled) => !covered.some((row) => spelled === row || spelled.startsWith(`${row}.`) || spelled.startsWith(`${row}[`)));
  result.due.push(...residue.map((spelled) => `config.${spelled} is not a key the schema declares; remove it by hand`));
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
  const steps = pathSteps(finding.path);
  steps[steps.length - 1] = finding.replacement.split('.').pop();

  return spellSteps(steps);
}

/**
 * Read a path off the parsed config. The path came from the walk that found
 * it, so every step exists.
 * @param {object} config
 * @param {string} spelled - e.g. 'seo.github.content[0].org'.
 * @returns {*}
 */
function valueAt(config, spelled) {
  return pathSteps(spelled).reduce((node, step) => (node == null ? undefined : node[step]), config);
}

module.exports = { layerFiles, authoredConfigFiles, readAuthoredConfig, migrateConfigFile };

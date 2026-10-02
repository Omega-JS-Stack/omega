/**
 * brandState: what a folder is to OMEGA, read without writing. It names the
 * state, lists each gap, names the target the folder sits in, and ends on the
 * one next command. Every fact it judges by has its home elsewhere: the brand
 * root is @omega.js/config's, the template mark is template-marker.js's, the
 * files a brand owes are the scaffold plan's, a retired key is the migrate
 * rule set's, a missing env key is missingEnvKeys's, and whether that key is
 * optional is serviceInputs's (`gates: false`), the answer preflight reads.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const JSON5 = require('json5');
const { missingEnvKeys, loadEnvRoots, resolveCompany, resolveConfigPath } = require('@omega.js/config');
const { resolvePackageDir } = require('@omega.js/devkit/local');

const { resolveBrandRoot, loadBrand, discoverTargets, APPS_SHAPE } = require('./brand.js');
const { buildScaffoldPlan } = require('./scaffold.js');
const { isTemplateCopy } = require('./template-marker.js');
const { authoredConfigFiles } = require('../migrate/config-pass.js');
const { findRetiredKeys } = require('../migrate/retired-keys.js');
const { answersFromBrand } = require('../onboard.js');
const { serviceInputs } = require('../config.js');

const STATES = Object.freeze(['empty', 'unrelated', 'template', 'half-done', 'brand', 'legacy']);

// The file macOS drops into any folder it opens: a folder holding only it is still empty
const OS_NOISE = '.DS_Store';

// The next command for a state that has only one
const NEXT = {
  empty: 'npx omega onboard',
  unrelated: 'mkdir <brand-id> && cd <brand-id> && npx omega onboard',
  template: 'npm start',
  legacy: 'npx omega migrate',
};

/**
 * Is the brand legacy: a retired key in any authored omega file, or the
 * `apps/` folder shape target discovery refuses? `omega migrate` names each one.
 *
 * @param {string} brandRoot - The brand root.
 * @returns {boolean}
 */
function isLegacy(brandRoot) {
  let targets;
  try {
    targets = discoverTargets(brandRoot);
  } catch (error) {
    if (error.code === APPS_SHAPE) return true;
    throw error;
  }

  return authoredConfigFiles(resolveConfigPath(brandRoot), targets).some(({ file }) => {
    try {
      return findRetiredKeys(JSON5.parse(fs.readFileSync(file, 'utf8'))).length > 0;
    } catch {
      // A file that does not parse is the config gap's to report, not a retired key
      return false;
    }
  });
}

/**
 * The paths the brand's git ignore rules match. A clone never carries an ignored
 * file (the `.env` stubs), so one is never owed. Outside a git work tree, or
 * with no git installed, no rule can be read and nothing counts as ignored.
 *
 * @param {string} brandRoot - The brand root.
 * @param {string[]} paths - Brand-relative paths.
 * @returns {Set<string>} The ignored ones.
 */
function ignoredPaths(brandRoot, paths) {
  if (paths.length === 0) return new Set();

  // Exit 0 prints the ignored paths; 1 means none is, 128 no work tree, and no git reads no rule
  const result = spawnSync('git', ['check-ignore', '--', ...paths], { cwd: brandRoot, encoding: 'utf8' });
  return new Set(result.status === 0 ? result.stdout.split('\n').filter(Boolean) : []);
}

/**
 * The packages a manifest declares that no node_modules climb finds.
 *
 * @param {string} dir - The manifest's folder.
 * @returns {string[]} Package names; empty when the folder has no package.json.
 */
function uninstalled(dir) {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) return [];

  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  return declared.filter((name) => !resolvePackageDir(name, dir));
}

/**
 * The gaps of a brand whose config is current: what the config load refuses,
 * the declared targets with no folder, the scaffold files that are gone, and
 * the dependencies npm has not installed.
 *
 * @param {string} brandRoot - The brand root.
 * @param {object} brand - The loadBrand() answer.
 * @returns {{ answers: object|null, missing: { files: string[], targets: string[], config: string[], install: string[] } }}
 */
function brandGaps(brandRoot, brand) {
  const missing = { files: [], targets: [], config: [], install: [] };
  missing.config.push(...(brand.configError ? [brand.configError] : []), ...brand.configErrors);

  // Which files and targets a brand owes comes from its config; one that does not load names neither
  if (brand.configError) return { answers: null, missing };
  let answers;
  try {
    answers = answersFromBrand(brand);
  } catch (error) {
    missing.config.push(error.message);
    return { answers: null, missing };
  }

  const exists = (relative) => fs.existsSync(path.join(brandRoot, relative));
  missing.targets = answers.targets.map((entry) => entry.name).filter((name) => !exists(`targets/${name}`));

  // A target with no folder is listed once, as a target, never again as its files
  const absent = missing.targets.map((name) => `targets/${name}/`);
  const gone = buildScaffoldPlan(answers).map((file) => file.path)
    .filter((relative) => !exists(relative) && !absent.some((prefix) => relative.startsWith(prefix)));
  const ignored = ignoredPaths(brandRoot, gone);
  missing.files = gone.filter((relative) => !ignored.has(relative));

  const manifestDirs = [brandRoot, ...answers.targets.filter((entry) => !missing.targets.includes(entry.name)).map((entry) => path.join(brandRoot, 'targets', entry.name))];
  missing.install = [...new Set(manifestDirs.flatMap(uninstalled))];

  return { answers, missing };
}

/**
 * The env keys `omega manage` would ask this brand for, names only: the
 * cascade manage reads (brand, then company), production pinned as manage pins it.
 * A key is optional when manage never gates a run on it (`gates: false` from
 * serviceInputs: the service never gates, or the key has its own provider switch).
 *
 * @param {string} brandRoot - The brand root.
 * @param {object} config - The loaded brand config.
 * @returns {Array<{ key: string, service: string, optional: boolean }>}
 */
function missingEnv(brandRoot, config) {
  loadEnvRoots([brandRoot, resolveCompany(brandRoot).dir], { environment: 'production' });
  const inputs = {};
  return missingEnvKeys(config, process.env, { verb: 'manage' }).map(({ key, service }) => {
    inputs[service] ||= serviceInputs(service);
    const row = inputs[service].find((input) => input.name === key);
    return { key, service, optional: row.gates === false };
  });
}

/**
 * The next command for a brand: the config first, since nothing else can be
 * judged past it, then the files onboarding fills, then the install. A whole
 * brand runs locally with no env key, so its next command is always `npm start`.
 */
function brandNext(missing) {
  if (missing.config.length > 0) return 'npx omega migrate';
  if (missing.files.length > 0 || missing.targets.length > 0) return 'npx omega onboard';
  if (missing.install.length > 0) return 'npm install';
  return 'npm start';
}

/**
 * The state of the folder at `cwd`. Reads only: the one side effect is the
 * brand's env cascade loaded into process.env, the same load manage makes.
 * The brand load skips its machine registry line.
 *
 * @param {string} cwd - The folder to judge.
 * @returns {{ state: string, brandRoot: string|null, inTarget: string|null, brand: { id: string, name: string }|null, targets: Array<{ name: string, type: string }>, missing: { files: string[], targets: string[], config: string[], install: string[], env: Array<{ key: string, service: string, optional: boolean }> }, next: string }}
 */
function brandState(cwd) {
  const dir = path.resolve(cwd);
  const brandRoot = resolveBrandRoot(dir);
  const report = (state, fields = {}) => ({
    state,
    brandRoot,
    inTarget: null,
    brand: null,
    targets: [],
    missing: { files: [], targets: [], config: [], install: [], env: [] },
    next: NEXT[state],
    ...fields,
  });

  if (!brandRoot) {
    if (fs.readdirSync(dir).every((entry) => entry === OS_NOISE)) return report('empty');
    return report(isTemplateCopy(dir) ? 'template' : 'unrelated');
  }

  const [top, name] = path.relative(brandRoot, dir).split(path.sep);
  const inTarget = top === 'targets' && name ? name : null;

  if (isLegacy(brandRoot)) return report('legacy', { inTarget });

  const brand = loadBrand(brandRoot, { record: false });
  const { answers, missing } = brandGaps(brandRoot, brand);
  const gaps = Object.values(missing).some((list) => list.length > 0);
  // Keys for going live are listed, but a brand runs locally without them: they never make it half-done
  const env = answers ? missingEnv(brandRoot, brand.config) : [];

  return report(gaps ? 'half-done' : 'brand', {
    inTarget,
    brand: answers ? { id: answers.id, name: answers.name } : null,
    targets: answers ? answers.targets.map((entry) => ({ name: entry.name, type: entry.type })) : [],
    missing: { ...missing, env },
    next: brandNext(missing),
  });
}

module.exports = { brandState, STATES };

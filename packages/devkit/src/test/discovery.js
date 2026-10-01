/**
 * Suite discovery for the devkit runner: every `*.test.js` under each test
 * root, narrowed by the test-target grammar (`framework:`, `project:`, `full:`
 * and bare paths, parsed in src/test/scope.js) and the opt-in lanes. A file or directory whose name starts with `_` is never a suite
 * (helpers, fixtures, `_init.js`).
 */

const fs = require('fs');
const path = require('path');

const { parseTestScope, isPathTargeted } = require('./scope.js');

/**
 * Every `*.test.js` under a dir, sorted. `_`- and `.`-prefixed entries are skipped at any depth.
 * @param {string} dir - The test root.
 * @returns {string[]} Absolute paths.
 */
function findTestFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.test.js')) found.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found.sort();
}

// The scope grammar is written with forward slashes on every platform.
function toPosix(p) {
  return String(p).split(path.sep).join('/').replace(/\\/g, '/');
}

/**
 * Does a file, relative to its root, match one scope path filter?
 * @param {string} rel - The file relative to its test root.
 * @param {string} rawPart - The filter as typed.
 * @returns {boolean} True on a match.
 */
function matchesFilter(rel, rawPart) {
  const relPosix = toPosix(rel);
  const relNoExt = relPosix.replace(/\.js$/, '').replace(/\.test$/, '');
  const pathPart = toPosix(rawPart);
  const partNoExt = pathPart.replace(/\.js$/, '').replace(/\.test$/, '');
  return relPosix.startsWith(pathPart)
    || relNoExt === partNoExt
    || relNoExt.startsWith(`${partNoExt}/`)
    || relPosix.includes(pathPart);
}

/**
 * Narrow candidate files to what one parsed scope selects.
 * @param {Array<{source: string, rel: string}>} candidates - Discovered files.
 * @param {object} scope - A parseTestScope() result.
 * @returns {Array<object>} The selected candidates, order kept.
 */
function selectByScope(candidates, scope) {
  return candidates.filter(({ source, rel }) => {
    if (!scope.sources.includes(source)) return false;
    const filters = scope.filters[source];
    return filters.length === 0 || filters.some((part) => matchesFilter(rel, part));
  });
}

/**
 * Is the run the framework testing itself? Then a bare run means its own suite,
 * and its framework `boot/` suites (which assert on its own fixture app) run.
 * With no framework root there is no framework suite to mean.
 * @param {{projectRoot: string, packageName?: string, roots: object[]}} config - The runner config.
 * @returns {boolean} True in framework self-test mode.
 */
function isSelfTest(config) {
  if (!config.packageName || !config.roots.some((root) => root.source === 'framework')) return false;
  const manifest = path.join(config.projectRoot, 'package.json');
  if (!fs.existsSync(manifest)) return false;
  return JSON.parse(fs.readFileSync(manifest, 'utf8')).name === config.packageName;
}

/**
 * Discover and scope the suites of one run.
 * @param {object} config - The runner config (`roots`, `projectRoot`, `packageName`, `frameworkAliases`, `lanes`).
 * @param {{targets?: string[], lane?: string}} options - The run options.
 * @returns {{files: Array<{file: string, source: string, root: string, rel: string}>, noMatch: string|null, invalid: string[]}}
 */
function discoverSuites(config, options) {
  const selfTest = isSelfTest(config);
  const lanes = (config.lanes || []).filter((lane) => lane !== options.lane);

  const candidates = [];
  for (const root of config.roots) {
    const rootDir = path.resolve(config.projectRoot, root.dir);
    for (const file of findTestFiles(rootDir)) {
      const rel = path.relative(rootDir, file);
      const dirs = toPosix(rel).split('/').slice(0, -1);
      if (dirs.some((dir) => lanes.includes(dir))) continue;
      // Framework boot/ suites assert on the framework's own fixture app.
      if (root.source === 'framework' && !selfTest && dirs[0] === 'boot') continue;
      candidates.push({ file, source: root.source, root: rootDir, rel });
    }
  }

  const scopeOptions = { frameworkAliases: config.frameworkAliases || [], selfTest };
  const targets = options.targets || [];
  const scope = parseTestScope(targets, scopeOptions);

  // A path target that selects nothing is a typo: the run names it and fails.
  const noMatch = targets.find((target) => {
    const single = parseTestScope([target], scopeOptions);
    return isPathTargeted(single) && selectByScope(candidates, single).length === 0;
  }) || null;

  return { files: selectByScope(candidates, scope), noMatch, invalid: scope.invalid };
}

module.exports = { discoverSuites, findTestFiles };

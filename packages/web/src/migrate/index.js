/**
 * index.js — the `omega migrate` orchestrator: one call converts a UJM
 * consumer to @omega.js/web.
 *
 *   1. Config: _config.yml + ultimate-jekyll-manager.json → config/omega.json5
 *      (validated through the real @omega.js/config loader after writing).
 *   2. Codemod: the rule tables over src/** templates and consumer JS
 *      (rules.js), plus the consumer asset layer (consumer-assets.js).
 *   3. Lint: the liquid-lint scanner over the (rewritten) templates.
 *   4. Hygiene: legacy files removed (Gemfile, lockfile, the old configs).
 *   5. Tests: the legacy UJM harness, reported (never rewritten).
 *
 * `check: true` runs everything IN MEMORY — full report, zero writes.
 */
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, resolveConfigPath, findBrandConfigPath } = require('@omega.js/config');
const { convertConfig, readLegacyConfigs, serializeOmega } = require('./config-convert.js');
const { runCodemod, collectTemplateFiles } = require('./codemod.js');
const { lintText } = require('./lint.js');
const { migrateConsumerAssets } = require('./consumer-assets.js');

// Legacy files deleted by a real migration (relative to the consumer root)
const LEGACY_FILES = [
  'src/_config.yml',
  'config/ultimate-jekyll-manager.json',
  'Gemfile',
  'Gemfile.lock',
  '.ruby-version',
];

// The legacy UJM harness. Its runner discovered ALL of `test/**/*.js`
// (excluding `_`-prefixed files and any `_`-prefixed directory — helpers,
// fixtures, `_init.js`) and read the layer from the module's own export, never
// from the path; `omega test` runs `node --test 'test/**/*.test.js'`, which
// matches almost none of them and reports a green `pass 0` — a migrated
// brand's whole regression suite goes dark without a word
// ([#248](https://github.com/Omega-JS-Stack/omega/issues/248)).
//
// Detection is by SHAPE, not by name: a harness module named `config.test.js`
// IS discovered by node:test, loads, registers no tests, and counts as a pass —
// the loudest false green there is. So a file that exports a module and never
// touches node:test is legacy whatever it is called, and a file that requires
// node:test is ported whatever it is called. Cheap enough to read: no execution.
const NODE_TEST_IMPORT = /(?:require\(\s*|from\s+)['"]node:test['"]/;
const MODULE_EXPORT = /(?:^|\n)\s*(?:module\.exports\s*=|exports\.[\w$]+\s*=|export\s+default\b)/;

/**
 * Whether a test-dir file is a legacy-harness module rather than a node:test
 * file, judged by its content.
 * @param {string} text - the file's source
 * @returns {boolean}
 */
function isLegacyHarnessFile(text) {
  if (NODE_TEST_IMPORT.test(text)) return false;
  return MODULE_EXPORT.test(text);
}

/**
 * Collect the legacy-harness test files `omega test` cannot discover (or
 * discovers and silently counts as an empty pass).
 * @param {string} root - consumer project root
 * @returns {string[]} paths relative to the root
 */
function collectLegacyTests(root) {
  const testDir = path.join(root, 'test');
  if (!fs.existsSync(testDir)) return [];

  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('_')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name) !== '.js') continue;
      if (isLegacyHarnessFile(fs.readFileSync(full, 'utf8'))) files.push(path.relative(root, full));
    }
  };
  walk(testDir);
  return files.sort();
}

/**
 * Migrate a UJM consumer in place (or preview with `check`).
 * @param {string} root - consumer project root
 * @param {object} [options]
 * @param {boolean} [options.check] - report only, write nothing
 * @returns {object} report
 */
function runMigration(root, options = {}) {
  const write = !options.check;
  const report = { root, check: !write, config: null, codemod: null, lint: [], removed: [], legacyTests: [], errors: [] };

  // ---- 1. Config conversion
  const { jekyll, ujm, files: legacySources } = readLegacyConfigs(root);
  const omegaPath = path.join(root, 'config', 'omega.json5');
  // The legacy guard runs FIRST, and stays first: a root that still carries
  // _config.yml / ultimate-jekyll-manager.json is MID-conversion — the
  // omega.json5 beside (or above) it is an earlier partial run or the brand
  // layer, and the legacy sources are the truth to convert from. Probing for a
  // converted config before this check would skip those roots forever.
  if (!jekyll && !ujm) {
    // Pre-converted is the fleet-standard order, not a failure
    // ([#297](https://github.com/Omega-JS-Stack/omega/issues/297)): the brand
    // root's omega.json5 lands first and the app's UJM configs are gone before
    // migrate ever runs, so the config step is DONE and the codemods below are
    // the rest of the job. Only a root with neither legacy configs NOR a
    // resolvable omega.json5 is genuinely broken.
    //
    // The omega.json5 the loadConfig contract resolves for this root: its own
    // file, else its brand root's (an app inside a brand monorepo rides the
    // brand config alone — the app-layer file is optional there).
    const converted = resolveConfigPath(root) || findBrandConfigPath(root);
    if (converted) {
      report.config = { skipped: true, path: path.relative(root, converted) };
      // "Already converted" is a claim about a config that WORKS, so the skip
      // branch runs the same loader validation the conversion branch does —
      // a file that throws (unparseable, secrets, bad targets) or carries
      // schema findings is a loud error here, never a silent exit 0.
      try {
        const { errors } = loadConfig(root, 'web');
        report.config.validation = errors.map((error) => error.message || String(error));
      } catch (e) {
        report.config.validation = [e.message];
      }
      report.errors.push(...report.config.validation);
    } else {
      report.errors.push('no legacy configs found (src/_config.yml / config/ultimate-jekyll-manager.json)');
    }
  } else {
    const { omega, notes } = convertConfig({ jekyll, ujm });
    report.config = { path: path.relative(root, omegaPath), sources: legacySources.map((file) => path.relative(root, file)), notes, omega };
    if (write) {
      fs.mkdirSync(path.dirname(omegaPath), { recursive: true });
      fs.writeFileSync(omegaPath, serializeOmega(omega));

      // Validate through the real loader — findings surface in the report
      const { errors } = loadConfig(root, 'web');
      report.config.validation = errors.map((error) => error.message || String(error));
    }
  }

  // ---- 2. Codemod over src/** templates + the consumer asset layer
  report.codemod = runCodemod(root, { write });
  const assets = migrateConsumerAssets(root, { write });
  report.removed.push(...assets.removed);
  report.lint.push(...assets.findings);
  if (assets.edits.length > 0) {
    report.codemod.files.push(...assets.edits.map((edit) => ({ path: edit.file, edits: [edit] })));
    report.codemod.totalEdits += assets.edits.length;
  }

  // ---- 3. Liquid-lint over the (post-rewrite) templates
  for (const filePath of collectTemplateFiles(path.join(root, 'src'))) {
    report.lint.push(...lintText(fs.readFileSync(filePath, 'utf8'), path.relative(root, filePath)));
  }
  report.lint.push(...report.codemod.findings);

  // ---- 4. Legacy file hygiene
  for (const rel of LEGACY_FILES) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    if (write) fs.rmSync(full);
    report.removed.push(rel);
  }

  // ---- 5. Legacy test harness (reported, never rewritten — porting a suite
  // to node:test is by hand)
  report.legacyTests = collectLegacyTests(root);

  return report;
}

module.exports = { runMigration, LEGACY_FILES };

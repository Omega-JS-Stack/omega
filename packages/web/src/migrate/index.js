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
 *   6. Dependencies: bare requires the consumer never declared, reported and
 *      never installed. The scan is @omega.js/devkit's `src/bare-requires.js`,
 *      shared with @omega.js/backend's own migrate (#600); web supplies its
 *      bundler aliases.
 *
 * `check: true` runs everything IN MEMORY — full report, zero writes.
 */
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, resolveConfigPath, findBrandConfigPath } = require('@omega.js/config');
const { convertConfig, readLegacyConfigs, serializeOmega } = require('./config-convert.js');
const { runCodemod, collectTemplateFiles } = require('./codemod.js');
const { configReads: configReadsRule } = require('./rules.js');
const { lintText } = require('./lint.js');
const { migrateConsumerAssets } = require('./consumer-assets.js');
const { collectBareRequires } = require('@omega.js/devkit/bare-requires');

const BUNDLER_ALIASES = ['__main_assets__', '__theme__', '@omega.js/client'];

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
  const report = { root, check: !write, config: null, codemod: null, lint: [], removed: [], legacyTests: [], bareRequires: [], errors: [] };

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
    // root's omega.json5 lands first and the target's UJM configs are gone before
    // migrate ever runs, so the config step is DONE and the codemods below are
    // the rest of the job. Only a root with neither legacy configs NOR a
    // resolvable omega.json5 is genuinely broken.
    //
    // The omega.json5 the loadConfig contract resolves for this root: its own
    // file, else its brand root's (a target inside a brand monorepo rides the
    // brand config alone — the local-layer file is optional there).
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

  // ---- 2b. The CONFIG file's own string values (#671). `targets.web.meta.title:
  // "Agency - {{ site.brand.name }}"` is a read like any other and has rendered
  // empty since #611 — but the codemod walks `src/**` and the build census is
  // per-template, so nothing saw it. Rewritten in the FILE, not the parsed
  // object: a brand's omega.json5 carries comments, and re-serializing would
  // eat them.
  //
  // A CHECK run on a legacy root has no file to read — it wrote nothing — so
  // the scan runs over the config the run WOULD have written. Skipping it there
  // reported a clean bill for exactly the pre-flight case `--check` is for.
  const resolvedConfigPath = report.config && report.config.path && path.resolve(root, report.config.path);
  const configExists = Boolean(resolvedConfigPath) && fs.existsSync(resolvedConfigPath);
  const configText = configExists ? fs.readFileSync(resolvedConfigPath, 'utf8')
    : (resolvedConfigPath && report.config.omega ? serializeOmega(report.config.omega) : null);
  if (configText !== null) {
    const rel = path.relative(root, resolvedConfigPath);
    const { text, edits, findings } = configReadsRule.apply(configText);
    if (edits.length > 0) {
      // `write` implies the file exists: the conversion branch above wrote it,
      // and the skip branch resolved one that was already there.
      if (write) fs.writeFileSync(resolvedConfigPath, text);
      report.codemod.files.push({ path: rel, edits });
      report.codemod.totalEdits += edits.length;
      report.lint.push(...findings.map((finding) => ({ ...finding, file: rel })));
    }
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

  // ---- 6. Dependency resolution (#600): a bare require that only the legacy
  // FLAT install answered. Reported with the fix, never installed. The scan is
  // devkit's, shared with @omega.js/backend's own migrate; what web adds is its
  // BUNDLER ALIASES, the specifiers the build resolves for the consumer,
  // subpaths included ([index.md](../../../../docs/web/index.md): `__main_assets__/*`
  // to the core layer, `__theme__/*` to the active theme, `@omega.js/client` to
  // the client package). None is a dependency a consumer may declare, since
  // installing `@omega.js/client` beside the framework is a SECOND client
  // runtime, so naming them would hand the report a fix that breaks the project.
  report.bareRequires = collectBareRequires(root, { aliases: BUNDLER_ALIASES });

  return report;
}

module.exports = { runMigration, LEGACY_FILES };

/**
 * index.js — the `omega migrate` orchestrator: one call converts a UJM
 * consumer to @omegajs/web.
 *
 *   1. Config: _config.yml + ultimate-jekyll-manager.json → config/omega.json5
 *      (validated through the real @omegajs/config loader after writing).
 *   2. Codemod: the rule table over src/** templates (rules.js).
 *   3. Lint: the liquid-lint scanner over the (rewritten) templates.
 *   4. Hygiene: legacy files removed (Gemfile, lockfile, the old configs).
 *
 * `check: true` runs everything IN MEMORY — full report, zero writes.
 */
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('@omegajs/config');
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

/**
 * Migrate a UJM consumer in place (or preview with `check`).
 * @param {string} root - consumer project root
 * @param {object} [options]
 * @param {boolean} [options.check] - report only, write nothing
 * @returns {object} report
 */
function runMigration(root, options = {}) {
  const write = !options.check;
  const report = { root, check: !write, config: null, codemod: null, lint: [], removed: [], errors: [] };

  // ---- 1. Config conversion
  const { jekyll, ujm, files: legacySources } = readLegacyConfigs(root);
  const omegaPath = path.join(root, 'config', 'omega.json5');
  if (!jekyll && !ujm) {
    report.errors.push(fs.existsSync(omegaPath)
      ? 'no legacy configs found — this project looks already migrated'
      : 'no legacy configs found (src/_config.yml / config/ultimate-jekyll-manager.json)');
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

  return report;
}

module.exports = { runMigration, LEGACY_FILES };

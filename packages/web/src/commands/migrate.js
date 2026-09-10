/**
 * `omega migrate` — convert a UJM (Jekyll) consumer to @omega.js/web in place:
 * legacy configs → config/omega.json5, the codemod rule tables over src/**
 * templates and consumer JS, the liquid-lint scan, legacy-file removal
 * (Gemfile & co), the legacy test-harness report, and the undeclared-dependency
 * report (#600).
 *
 * `omega migrate --check` runs the full pipeline in memory and prints the
 * report without writing anything — the pre-flight for Phase-4 site waves.
 */
const Logger = require('@omega.js/devkit/logger');
const { runMigration } = require('../migrate/index.js');

const logger = new Logger('migrate');

module.exports = async function (options) {
  const check = Boolean(options.check || options['dry-run']);
  const root = process.cwd();

  logger.log(`${check ? 'Checking' : 'Migrating'} ${root}`);
  const report = runMigration(root, { check });

  // ---- config
  if (report.config && report.config.skipped) {
    logger.log(`Config: already converted (${report.config.path}), skipping the conversion step`);
  } else if (report.config) {
    const verb = check ? 'would write' : 'wrote';
    logger.log(`Config: ${verb} ${report.config.path} (from ${report.config.sources.join(' + ')})`);
    for (const note of report.config.notes) logger.warn(`  note: ${note}`);
    for (const error of report.config.validation || []) logger.error(`  validation: ${error}`);
  }

  // ---- codemod
  const { files, totalEdits } = report.codemod;
  logger.log(`Codemod: ${totalEdits} edit${totalEdits === 1 ? '' : 's'} across ${files.length} file${files.length === 1 ? '' : 's'}${check ? ' (preview)' : ''}`);
  for (const file of files) {
    const byRule = {};
    for (const edit of file.edits) byRule[edit.rule] = (byRule[edit.rule] || 0) + 1;
    const summary = Object.entries(byRule).map(([rule, count]) => `${rule}×${count}`).join(', ');
    logger.log(`  ${file.path}: ${summary}`);
  }

  // ---- lint findings
  const errors = report.lint.filter((finding) => finding.severity === 'error');
  const warnings = report.lint.filter((finding) => finding.severity !== 'error');
  if (report.lint.length > 0) {
    logger.log(`Lint: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
    for (const finding of errors) logger.error(`  ${finding.file}:${finding.line} — ${finding.message}`);
    for (const finding of warnings) logger.warn(`  ${finding.file}:${finding.line} — ${finding.message}`);
  } else {
    logger.log('Lint: clean');
  }

  // ---- legacy test harness (a silent `pass 0` otherwise)
  if (report.legacyTests.length > 0) {
    const count = report.legacyTests.length;
    logger.warn(`Tests: ${count} legacy test file${count === 1 ? '' : 's'} will not be discovered — \`omega test\` runs \`node --test 'test/**/*.test.js'\`, which matches no \`test/<layer>/<name>.js\` and reports a green pass 0. Rename to \`*.test.js\` and port to node:test.`);
    for (const rel of report.legacyTests) logger.warn(`  ${rel}`);
  }

  // ---- dependency resolution (#600): a bare require only the legacy FLAT
  // install answered. Lazy ones load fine and 500 on the first real call.
  if (report.bareRequires.length > 0) {
    const count = report.bareRequires.length;
    logger.warn(`Dependencies: ${count} bare require${count === 1 ? '' : 's'} of a package this project does not declare — the legacy flat install resolved them, an OMEGA install resolves them only by hoisting:`);
    for (const entry of report.bareRequires) logger.warn(`  ${entry.file}:${entry.line} — \`${entry.module}\`: ${entry.fix}`);
  }

  // ---- removed files + fatal problems
  for (const rel of report.removed) logger.log(`${check ? 'Would remove' : 'Removed'}: ${rel}`);
  for (const error of report.errors) logger.error(error);

  if (report.errors.length > 0) {
    process.exitCode = 1;
    return;
  }

  if (!check) {
    logger.log('');
    logger.log('Next steps:');
    logger.log('  1. Review the lint findings above (errors need manual ports)');
    logger.log('  2. npx omega build   — scaffolds project files + syncs scripts, then builds');
    logger.log('  3. npm run build     — verify the site builds');
    logger.log('  4. Remove _site/ and any leftover Jekyll artifacts');
  }
};

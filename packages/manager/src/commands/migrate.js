/**
 * `omega migrate` at a brand root — bring an already-converted omega.json5
 * forward: delete every key `@omega.js/config`'s retired-keys table names,
 * in place, comments and formatting preserved.
 *
 *   omega migrate            → remove the retired keys, one line each
 *   omega migrate --dry-run  → print the same plan and write nothing
 *
 * There is no dual-read anywhere in OMEGA, so a retired key is a setting the
 * brand still believes in and nothing reads — the validator says so loudly on
 * every load. The UJM→omega converter drops them on its way through
 * (@omega.js/web's `omega migrate`), but a brand ALREADY on omega.json5 had
 * only that error and an edit by hand. Editing an AUTHORED omega.json5 is the
 * manager's lane (#612), so the rule lives here.
 *
 * The file is read raw (JSON5, no merge): the retired key must be deleted
 * where the brand WROTE it, and a merged view would name paths that exist in
 * no file. Idempotent by construction — a key that isn't there is skipped, so
 * a converged brand's rerun leaves the file byte-identical.
 */
const fs = require('node:fs');
const chalk = require('chalk').default;
const JSON5 = require('json5');

const { findRetiredKeys, resolveConfigPath, removeConfigValues } = require('@omega.js/config');
const { resolveBrandRoot } = require('../lib/brand.js');

module.exports = async (options = {}) => {
  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run `omega migrate` at the brand root.'));
    process.exitCode = 1;
    return;
  }

  const configPath = resolveConfigPath(brandRoot);
  let authored;

  try {
    authored = JSON5.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error(chalk.red(`✗ ${configPath} does not parse — fix the syntax first: ${e.message}`));
    process.exitCode = 1;
    return;
  }

  // One finding per key, in file order. The table can name the same path
  // twice (a key that is both a retired NAME and a retired PATH); the file
  // has one property to delete either way.
  const findings = [];
  for (const finding of findRetiredKeys(authored)) {
    if (!findings.some((seen) => seen.path === finding.path)) findings.push(finding);
  }

  const dryRun = !!(options['dry-run'] || options.dryRun);

  console.log(chalk.bold(`\nOMEGA migrate — ${configPath}`));

  if (findings.length === 0) {
    console.log(`  ${chalk.green('✓')} no retired keys — this config is current`);
    return;
  }

  const report = removeConfigValues(brandRoot, findings.map((finding) => finding.path), { dryRun });

  for (const finding of findings) {
    const verb = dryRun ? chalk.dim('⊘ would remove') : `${chalk.green('✓')} removed`;
    console.log(`  ${verb} ${chalk.cyan(finding.path)} ${chalk.dim(`→ ${finding.replacement}`)}`);
    console.log(`      ${chalk.dim(finding.why)}`);
  }

  const count = report.removed.length;
  console.log(dryRun
    ? chalk.dim(`\n  ${count} retired key${count === 1 ? '' : 's'} would be removed — nothing written (dry run)`)
    : chalk.dim(`\n  ${count} retired key${count === 1 ? '' : 's'} removed — move each setting to the block named above`));
};

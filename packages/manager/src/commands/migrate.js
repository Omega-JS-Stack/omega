/**
 * `omega migrate` at a brand root — bring an already-converted omega.json5
 * forward: delete every key `@omega.js/config`'s retired-keys table names,
 * in place, comments and formatting preserved.
 *
 *   omega migrate            → remove the retired keys, one line each
 *   omega migrate --dry-run  → print the same plan and write nothing
 *
 * A retired row may also carry a `convert(oldValue)` ([#858](https://github.com/Omega-JS-Stack/omega/issues/858)):
 * the setting MOVES rather than merely vanishing. The converted value is
 * WRITTEN first, through the same comment-preserving editor, and the old key
 * is deleted in the same run, so a brand never sits between the two shapes,
 * and a dry run prints both halves. This is the ONE verb for retired config
 * keys; a `--migration=` manage pass is for what a key change implies OUTSIDE
 * the config (the platform-names migration renames icon folders too).
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
const { isDeepStrictEqual } = require('node:util');
const chalk = require('chalk').default;
const JSON5 = require('json5');

const { findRetiredKeys, resolveConfigPath, removeConfigValues, writeConfigValues } = require('@omega.js/config');
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

  // Conversions FIRST (#858): the new key is written while the old one is
  // still there to read, then the removal pass takes the old key away. A row
  // with no `convert` is a plain deletion, exactly as before.
  //
  // A conversion never OVERWRITES an authored value: a brand that started the
  // migration by hand carries both keys, and the converted old setting would
  // silently replace the one it wrote. That row is refused whole, its old key
  // left in place too, so the human still has both halves to choose between.
  const conversions = [];
  const conflicts = [];
  for (const finding of findings.filter((entry) => typeof entry.convert === 'function')) {
    const target = convertedPath(finding);
    const value = finding.convert(valueAt(authored, finding.path));
    const present = valueAt(authored, target);

    if (present !== undefined && !isDeepStrictEqual(present, value)) {
      conflicts.push({ finding, path: target, present });
      continue;
    }

    conversions.push({ finding, path: target, value });
  }

  if (conversions.length) {
    writeConfigValues(
      brandRoot,
      Object.fromEntries(conversions.map(({ path, value }) => [path, value])),
      { dryRun },
    );
  }

  const refused = new Set(conflicts.map((entry) => entry.finding));
  const report = removeConfigValues(brandRoot, findings.filter((finding) => !refused.has(finding)).map((finding) => finding.path), { dryRun });

  for (const finding of findings) {
    const conflict = conflicts.find((entry) => entry.finding === finding);
    const converted = conversions.find((entry) => entry.finding === finding);

    if (conflict) {
      console.log(`  ${chalk.red('✗')} refused ${chalk.cyan(finding.path)} ${chalk.dim('→')} ${chalk.cyan(conflict.path)} ${chalk.dim(`: ${conflict.path} is already authored here = ${JSON.stringify(conflict.present)}`)}`);
      console.log(`      ${chalk.dim('both settings are in this file: delete one of the two by hand, then run `omega migrate` again')}`);
      continue;
    }

    if (converted) {
      const verb = dryRun ? chalk.dim('⊘ would move') : `${chalk.green('✓')} moved`;
      console.log(`  ${verb} ${chalk.cyan(finding.path)} ${chalk.dim('→')} ${chalk.cyan(converted.path)} ${chalk.dim(`= ${JSON.stringify(converted.value)}`)}`);
    } else {
      const verb = dryRun ? chalk.dim('⊘ would remove') : `${chalk.green('✓')} removed`;
      console.log(`  ${verb} ${chalk.cyan(finding.path)} ${chalk.dim(`→ ${finding.replacement}`)}`);
    }

    console.log(`      ${chalk.dim(finding.why)}`);
  }

  const count = report.removed.length;
  console.log(dryRun
    ? chalk.dim(`\n  ${count} retired key${count === 1 ? '' : 's'} would be removed — nothing written (dry run)`)
    : chalk.dim(`\n  ${count} retired key${count === 1 ? '' : 's'} removed — move each setting to the block named above`));

  if (conflicts.length) process.exitCode = 1;
};

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

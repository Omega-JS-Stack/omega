/**
 * Self-healing config ([#478](https://github.com/Omega-JS-Stack/omega/issues/478)):
 * every manage run materializes the schema-defaulted blocks the brand's
 * omega.json5 does not carry yet, so a subsystem that exists has its config
 * structure visible and editable in the file — never an invisible framework
 * fallback. A newly added default therefore appears in every consumer's config
 * on the next run.
 *
 * What it never does: overwrite. `missingDefaults()` names only the keys the
 * brand has not authored, the comment-preserving editor inserts them (each
 * block documented with the schema's own description), and a converged config
 * leaves the file byte-identical. Keys with no sane framework answer — owner
 * decisions, provisioned ids, anything secret-shaped — carry no schema default
 * and are never written here.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const JSON5 = require('json5');

const { missingDefaults, defaultComments, writeConfigValues, resolveConfigPath, FILE_NAME } = require('@omega.js/config');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async ({ brandRoot, options = {} }) => {
  const configPath = resolveConfigPath(brandRoot);
  if (!configPath) {
    console.log(`      ${chalk.dim(`⊘ no ${join('config', FILE_NAME)} yet (the config operation reports it)`)}`);
    return null;
  }

  // The RAW file, not the resolved config: resolution already merged the
  // defaults in, so every block would read as present.
  const missing = missingDefaults(JSON5.parse(jetpack.read(configPath)));

  if (missing.length === 0) {
    console.log(`      ${chalk.green('✓')} ${FILE_NAME} carries every schema default`);
    return null;
  }

  const blocks = missing.map((entry) => entry.path);

  if (options.dryRun) {
    return dryRunPlan(
      `materialize ${blocks.join(', ')} in ${FILE_NAME}`,
      { output: { defaults: { planned: blocks } } },
    );
  }

  writeConfigValues(
    brandRoot,
    Object.fromEntries(missing.map((entry) => [entry.path, entry.value])),
    { comments: defaultComments() },
  );

  for (const block of blocks) {
    console.log(`      ${chalk.green('+')} ${FILE_NAME} ← ${chalk.cyan(block)} ${chalk.dim('(schema default)')}`);
  }

  return { output: { defaults: { materialized: blocks } } };
};

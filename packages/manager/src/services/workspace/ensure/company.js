/**
 * Ensure the brand states its company ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)):
 * one top-level `company: { id }` is what joins a brand to its company, and
 * everything the company owns — the config layer, the `.env` under this
 * brand's own, the owner hooks, the Apple signing tree — follows from it.
 *
 * A brand that carries no `company` key has never been asked, so an
 * interactive walk asks it here, in the same words the onboard wizard uses
 * (lib/company-question.js). Blank is a real answer — the standalone brand —
 * and writes nothing; a non-interactive run says the question is pending and
 * reconciles nothing.
 */
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

const { resolveConfigPath, FILE_NAME } = require('@omega.js/config');

const { askCompanyId } = require('../../../lib/company-question.js');
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { canPrompt } = require('../../../lib/run-gates.js');

module.exports = async (context, deps = {}) => {
  const { brandRoot, options = {} } = context;

  const configPath = resolveConfigPath(brandRoot);
  if (!configPath) {
    console.log(`      ${chalk.dim(`⊘ no ${FILE_NAME} yet (the config operation reports it)`)}`);
    return null;
  }

  // The RAW file, not the resolved config: the loader FILLS `company` on every
  // brand, so only the authored key says the question was answered.
  const authored = JSON5.parse(jetpack.read(configPath)).company;

  if (authored) {
    console.log(`      ${chalk.green('✓')} company ${chalk.dim(`(${authored.id})`)}`);
    return null;
  }

  if (!canPrompt(options)) {
    console.log(`      ${chalk.dim('⊘ no company key yet — an interactive run asks for it')}`);
    return null;
  }

  const id = await askCompanyId(deps);
  if (!id) {
    console.log(`      ${chalk.dim('• standalone brand — nothing written')}`);
    return null;
  }

  writeBrandConfig(context, { 'company.id': id });

  return { output: { company: { id } } };
};

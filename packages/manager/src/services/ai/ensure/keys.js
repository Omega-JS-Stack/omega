/**
 * Report which AI providers this brand can call. The setup gate already
 * acquired what was missing (or skipped the whole service), so by here the
 * environment IS the answer — this names it, so the run record says which
 * providers the backend has credentials for instead of leaving it implicit.
 *
 * Names only: a value never reaches the log.
 */
const chalk = require('chalk').default;

const { serviceInputSpec } = require('../../../config.js');

module.exports = () => {
  const configured = serviceInputSpec('ai').inputs
    .filter((input) => process.env[input.name])
    .map((input) => input.name);

  console.log(`      ${chalk.green('✓')} Configured: ${chalk.cyan(configured.join(', '))}`);

  return { output: { configured } };
};

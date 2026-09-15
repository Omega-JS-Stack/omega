/**
 * `omega-manager company <init>`: the COMPANY rung's own verb.
 *
 *   omega company init   create the `company/` tree in THIS brand (it must be
 *                        the company brand: `company: { id: 'self' }`)
 *
 * That is the whole surface: a brand JOINS a company by naming it with
 * `company: { id }` in its own config, so nothing else needs a command
 * ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)).
 */
const chalk = require('chalk').default;

const { runCompanyInit } = require('../company-init.js');

const USAGE = [
  'Usage: omega company <command>',
  '',
  '  init   create the company/ tree in this brand (company: { id: "self" })',
].join('\n');

module.exports = async (options) => {
  const subcommand = options._?.[1];

  try {
    if (subcommand === 'init') {
      runCompanyInit(process.cwd());
      return;
    }

    console.error(subcommand
      ? `${chalk.red('❌ Unknown company command')} ${chalk.dim(`"${subcommand}"`)}\n\n${USAGE}`
      : USAGE);
    process.exitCode = 1;
  } catch (error) {
    console.error(`${chalk.red('❌ Error')}${chalk.dim(`: ${error.message}`)}`);
    process.exitCode = 1;
  }
};

module.exports.USAGE = USAGE;

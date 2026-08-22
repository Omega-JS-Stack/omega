/**
 * `omega-manager company <init|adopt>` — the COMPANY rung's own verb.
 *
 *   omega company init [path]          scaffold a company workspace (default: cwd)
 *   omega company adopt <brand-path>   stamp a brand so it inherits this company
 *
 * Everything else about a company workspace rides the verbs it already has:
 * `omega manage` from a company root fans out over its brands, `omega
 * onboard` creates a new brand under brands.roots[0] and stamps it.
 */
const chalk = require('chalk').default;

const { runCompanyInit, runCompanyAdopt } = require('../company-init.js');

const USAGE = [
  'Usage: omega company <command>',
  '',
  '  init [path]          scaffold a company workspace (default: the current directory)',
  '  adopt <brand-path>   stamp a brand so it inherits this company workspace',
].join('\n');

module.exports = async (options) => {
  const subcommand = options._?.[1];

  try {
    if (subcommand === 'init') {
      runCompanyInit(options._?.[2] || process.cwd());
      return;
    }

    if (subcommand === 'adopt') {
      runCompanyAdopt(process.cwd(), options._?.[2]);
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

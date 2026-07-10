/**
 * `omega-manager devlog` — generate a commit-digest blog post from recent
 * GitHub activity and publish it to the brand's website app.
 *
 * Flags: --brand=<id> (company workspaces; default = the single brand with
 * devlog.enabled), --days=<n> overrides devlog.lookbackDays for this run,
 * --dry-run collects + generates only and writes a preview to .omega/devlog/
 * instead of publishing.
 */
const chalk = require('chalk').default;

const { runDevlog } = require('../devlog/index.js');

module.exports = async (options) => {
  try {
    await runDevlog(process.cwd(), {
      brand: options.brand,
      days: options.days,
      dryRun: options.dryRun,
    });
  } catch (error) {
    console.error(`${chalk.red('❌ Error')}${chalk.dim(`: ${error.message}`)}`);
    process.exitCode = 1;
  }
};

/**
 * `omega-manager manage` — run every service (or --service=<name>) against the
 * brand monorepo that contains the cwd. Sets process.exitCode = 1 when any
 * service errored so CI and scripts can gate on it.
 */
const { runManage } = require('../manage.js');

module.exports = async (options) => {
  const report = await runManage(process.cwd(), {
    service: options.service,
    continueOnError: options.continueOnError,
    dryRun: options.dryRun,
    verbose: options.verbose,
  });

  if (report.hasErrors) {
    process.exitCode = 1;
  }
};

/**
 * `omega-manager manage`: run every service (or --service=<name>) against
 * the brand the cwd resolves into.
 *
 * Sets process.exitCode = 1 when any service errored so CI and scripts can
 * gate on it.
 */
const path = require('node:path');
const attachLogFile = require('@omega.js/devkit/attach-log-file');
const { runManage } = require('../manage.js');
const { resolveBrandRoot } = require('../lib/brand.js');

module.exports = async (options) => {
  // Tee the whole walk to <brandRoot>/logs/manage.log (#197): one greppable
  // record of the service walk. Outside a brand the verb errors out anyway, so
  // cwd is the honest fallback.
  attachLogFile(path.join(resolveBrandRoot(process.cwd()) || process.cwd(), 'logs', 'manage.log'));

  const report = await runManage(process.cwd(), {
    service: options.service,
    continueOnError: options.continueOnError,
    dryRun: options.dryRun,
    strict: options.strict,
    verbose: options.verbose,
    migration: options.migration,
    execute: options.execute,
    limit: options.limit,
    ids: options.ids,
    resetAssets: options.resetAssets,
    force: options.force,
  });

  if (report.hasErrors) {
    process.exitCode = 1;
  }
};

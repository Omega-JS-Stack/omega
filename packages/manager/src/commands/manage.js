/**
 * `omega-manager manage` — context-sensitive on where it runs:
 *   inside a brand monorepo    → run every service (or --service=<name>)
 *                                against that brand
 *   inside a company workspace → run the same per-brand manage for every
 *                                discovered brand (--brand=<id[,id]> filters,
 *                                --parallel runs children concurrently)
 *
 * Sets process.exitCode = 1 when any service errored so CI and scripts can
 * gate on it.
 */
const path = require('node:path');
const attachLogFile = require('@omega.js/devkit/attach-log-file');
const { runManage } = require('../manage.js');
const { runCompany } = require('../company.js');
const { resolveManageRoot, filterChildArgs } = require('../lib/company.js');

module.exports = async (options) => {
  const resolved = resolveManageRoot(process.cwd());

  // Tee the whole fan-out to <brandRoot>/logs/manage.log (#197) — one greppable
  // record of the service walk. Outside a brand the verb errors out anyway, so
  // cwd is the honest fallback.
  attachLogFile(path.join(resolved?.root || process.cwd(), 'logs', 'manage.log'));

  let report;
  if (resolved?.isCompany) {
    // Children get the user's argv minus the company-only flags
    report = await runCompany(resolved.root, {
      brand: options.brand,
      parallel: options.parallel,
      concurrency: options.concurrency,
    }, filterChildArgs(process.argv.slice(2)));
  } else {
    report = await runManage(process.cwd(), {
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
    });
  }

  if (report.hasErrors) {
    process.exitCode = 1;
  }
};

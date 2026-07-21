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
const { runManage } = require('../manage.js');
const { runCompany } = require('../company.js');
const { resolveManageRoot, filterChildArgs } = require('../lib/company.js');

module.exports = async (options) => {
  const resolved = resolveManageRoot(process.cwd());

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
      limit: options.limit,
      ids: options.ids,
    });
  }

  if (report.hasErrors) {
    process.exitCode = 1;
  }
};

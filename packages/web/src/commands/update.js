/**
 * `omega update` — dependency freshness (npu-outdated semantics):
 * installed/wanted/latest + patch/minor/major per dep, releases younger than
 * --min-age days (default 7) QUARANTINED. A bare run installs the
 * non-quarantined, non-breaking set (`--major` opts into breaking) through
 * npu when present; `--dry-run` reports and installs nothing. The whole verb
 * is the shared devkit implementation.
 */
const Logger = require('@omega.js/devkit/logger');
const { runUpdate } = require('@omega.js/devkit/update');

const logger = new Logger('update');

module.exports = async function (options) {
  await runUpdate({
    dir: process.cwd(),
    dryRun: options.dryRun || options['dry-run'],
    major: options.major,
    minAge: options.minAge ?? options['min-age'],
    forceFresh: options.forceFresh || options['force-fresh'],
    logger,
  });
};

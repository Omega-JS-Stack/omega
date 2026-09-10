/**
 * `omega update` — dependency freshness report (npu-outdated semantics):
 * installed/wanted/latest + patch/minor/major per dep, releases younger than
 * --min-age days (default 7) QUARANTINED. `--apply` installs the
 * non-quarantined, non-breaking set (`--major` opts into breaking) through
 * npu when present. The whole verb is the shared devkit implementation.
 */
const Logger = require('@omega.js/devkit/logger');
const { runUpdate } = require('@omega.js/devkit/update');

const logger = new Logger('update');

module.exports = async function (options) {
  await runUpdate({
    dir: process.cwd(),
    apply: options.apply,
    major: options.major,
    minAge: options.minAge ?? options['min-age'],
    forceFresh: options.forceFresh || options['force-fresh'],
    logger,
  });
};

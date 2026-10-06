/**
 * The built-output checks the smoke suite runs over a target's `dist/`: the
 * internal link check and the four audit checks (page meta, anchor fragments,
 * image alt, sitemap orphans), each as one failure line per offender.
 */
const { checkDistLinks, loadExceptions, loadLinkExceptions, EXCEPTIONS_FILE } = require('../link-resolver.js');
const { auditDist } = require('../dist-audit.js');

/**
 * The built-output link check as smoke-check lines.
 *
 * Both halves are failures: a link that resolves to nothing, and a declared
 * exception that has started resolving (an exception standing over a fixed link
 * masks the next regression at that URL, so the declared list has to shrink).
 *
 * @param {object} options
 * @param {string} options.distDir - the build output
 * @param {string} options.targetRoot - the consumer root (holds the exception list)
 * @returns {string[]} one line per failure (empty = the check passed)
 */
function linkCheckFailures(options) {
  const { offenders, stale } = checkDistLinks({
    distDir: options.distDir,
    exceptions: loadLinkExceptions(options.targetRoot),
  });

  return [
    ...offenders.map((entry) => `dead internal link: ${entry}; add the page or fix the link`),
    ...stale.map((entry) => `stale link exception in ${EXCEPTIONS_FILE}: ${entry} resolves now; drop it`),
  ];
}

/**
 * The built-output audit checks as smoke-check lines, over ONE walk of the dist
 * the link check reads. Same two halves as the link check: a page that fails a
 * check, and a declared exception that has started passing.
 * @param {object} options
 * @param {string} options.distDir - the build output
 * @param {string} options.targetRoot - the consumer root (holds the exception list)
 * @returns {string[]} one line per failure (empty = the checks passed)
 */
function auditCheckFailures(options) {
  const audit = auditDist({
    distDir: options.distDir,
    exceptions: loadExceptions(options.targetRoot),
  });

  return [
    ...audit.meta.offenders.map((entry) => `missing page meta: ${entry}; set it in the page's meta: frontmatter`),
    ...audit.fragments.offenders.map((entry) => `dead anchor fragment: ${entry}; add the id to the page or fix the link`),
    ...audit.alt.offenders.map((entry) => `image without alt: ${entry}; add alt (alt="" for a decorative image)`),
    ...audit.sitemap.offenders.map((entry) => `page missing from sitemap.xml: ${entry}; a page kept out of the sitemap must also be noindex (meta.index: false, one decision per #564), or declare 'sitemap: true' for it in config/link-exceptions.json5`),
    ...['meta', 'fragments', 'alt', 'sitemap'].flatMap((check) => audit[check].stale
      .map((entry) => `stale ${check} exception in ${EXCEPTIONS_FILE}: ${entry} passes now; drop it`)),
  ];
}

module.exports = { linkCheckFailures, auditCheckFailures };

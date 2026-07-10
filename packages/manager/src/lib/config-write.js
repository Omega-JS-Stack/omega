/**
 * Brand-config writeback — the manager side of @omega.js/config's
 * comment-preserving editor. Services resolve IDs against external APIs
 * (SendGrid list, Beehiiv publication, payment product IDs, the Firebase SDK
 * config) and land them in config/omega.json5, their one authoritative home;
 * state keeps the resolved values as a cache/self-heal layer. This helper
 * gives every service the same dry-run gate and logging.
 */

const chalk = require('chalk').default;
const { writeConfigValues } = require('@omega.js/config');

/**
 * Write resolved values into the brand's omega.json5. Already-equal values
 * are skipped by the editor, so calling this on every run is idempotent and
 * reruns leave the file byte-identical. Dry-run reports what would land and
 * touches nothing.
 *
 * @param {Object} context - Handler context ({ brandRoot, options }).
 * @param {Object<string, *>} edits - Dot-path → value (see @omega.js/config
 *   edit paths: dots, numeric indexes, and [key=value] array matchers).
 * @returns {string[]} The paths actually written (empty on dry-run or no-op).
 */
function writeBrandConfig(context, edits) {
  const dryRun = context.options?.dryRun || false;
  const report = writeConfigValues(context.brandRoot, edits, { dryRun });

  if (report.applied.length === 0) {
    return [];
  }

  if (dryRun) {
    console.log(`      ${chalk.dim(`⊘ Dry run — would write ${report.applied.join(', ')} to omega.json5`)}`);
    return [];
  }

  console.log(`      ${chalk.green('✓')} omega.json5 ← ${chalk.cyan(report.applied.join(', '))}`);
  return report.applied;
}

module.exports = { writeBrandConfig };

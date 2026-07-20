/**
 * The framework's @omega.js/config for shipped TEST files.
 *
 * @omega.js/config is a PRIVATE workspace package — it never publishes, so a
 * registry install has nothing to resolve by that name. The framework's dist
 * carries a vendored copy (dist/vendor/config, written at prepare time) that
 * is byte-equivalent to the workspace package, and the monorepo's dist is
 * freshly prepared before any suite runs — so BOTH environments resolve the
 * same code through this one path. Test files must require config through
 * this helper, never `@omega.js/config` directly (pack-smoke greps shipped
 * trees for raw private references).
 */
const path = require('node:path');

module.exports = require(path.join(__dirname, '..', '..', 'dist', 'vendor', 'config', 'index.js'));

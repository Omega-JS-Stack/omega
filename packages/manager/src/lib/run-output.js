/**
 * Per-run output — the ONLY thing a manage run writes into `.omega/`:
 *
 *   config/omega.json5      → every provisioned fact (ids, slugs, zones,
 *                             confirmation flags), comment-preserving
 *   .env                    → every secret the run resolves (never config —
 *                             the loader hard-fails secret-shaped keys)
 *   .omega/runs/{ts}.json   → this run's transient output (counts, status
 *                             flags, errors), for post-mortem debugging
 *
 * The old third bucket — the durable cache of derived data `.omega/state.json`
 * carried — is RETIRED ([#434](https://github.com/Omega-JS-Stack/omega/issues/434)):
 * every fact it held either re-derives from the platform on each idempotent
 * ensure, or has an authoritative home in config/.env. The FILE lives on as
 * the per-machine RECORD home ([#479](https://github.com/Omega-JS-Stack/omega/issues/479))
 * — deploy stamps under its `deploy` section, written by
 * `@omega.js/devkit/deploy-record` and by nothing here. `.omega/` is
 * gitignored (the workspace service ensures the entry).
 */

const { join } = require('node:path');
const jetpack = require('fs-jetpack');

/**
 * Persist one run's transient output to .omega/runs/{timestamp}.json —
 * failures, counts, and per-service flags for post-mortem debugging.
 *
 * @param {string} brandRoot - Brand-monorepo root
 * @param {string} runTimestamp - Filesystem-safe ISO timestamp for this process
 * @param {string} brandId - Brand ID
 * @param {Array<{ service, status, output, error }>} services - Per-service results
 */
function writeRunOutput(brandRoot, runTimestamp, brandId, services) {
  const runFile = join(brandRoot, '.omega', 'runs', `${runTimestamp}.json`);
  jetpack.write(runFile, {
    timestamp: new Date().toISOString(),
    brandId,
    services,
  }, { jsonIndent: 2 });
}

module.exports = { writeRunOutput };

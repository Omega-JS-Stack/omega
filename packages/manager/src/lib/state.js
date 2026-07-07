/**
 * The .omega/ state store — omega-manager's three-bucket principle in the
 * brand monorepo itself:
 *
 *   config/omega.json5      → user choices        (committed, human-edited)
 *   .omega/state.json       → durable derived data (API-returned IDs; persists across runs)
 *   .omega/runs/{ts}.json   → transient per-run output (counts, status flags, errors)
 *
 * .omega/ is gitignored (the workspace service ensures the entry). Secrets
 * stay in .env — never in state.
 */

const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const STATE_DIR = '.omega';

function statePath(brandRoot) {
  return join(brandRoot, STATE_DIR, 'state.json');
}

/**
 * Read durable brand state (per-service keyed). Missing file → {}.
 */
function readState(brandRoot) {
  return jetpack.read(statePath(brandRoot), 'json') || {};
}

/**
 * Persist durable brand state.
 */
function writeState(brandRoot, state) {
  jetpack.write(statePath(brandRoot), state, { jsonIndent: 2 });
}

/**
 * Persist one run's transient output to .omega/runs/{timestamp}.json —
 * failures, counts, and per-service flags for post-mortem debugging, without
 * contaminating durable state.json.
 *
 * @param {string} brandRoot - Brand-monorepo root
 * @param {string} runTimestamp - Filesystem-safe ISO timestamp for this process
 * @param {string} brandId - Brand ID
 * @param {Array<{ service, status, output, error }>} services - Per-service results
 */
function writeRunOutput(brandRoot, runTimestamp, brandId, services) {
  const runFile = join(brandRoot, STATE_DIR, 'runs', `${runTimestamp}.json`);
  jetpack.write(runFile, {
    timestamp: new Date().toISOString(),
    brandId,
    services,
  }, { jsonIndent: 2 });
}

module.exports = { STATE_DIR, readState, writeState, writeRunOutput, statePath };

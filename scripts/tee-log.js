/**
 * Monorepo-surface log tee (#197 spec item 4) — the one place that says where a
 * root surface's log file lives and attaches the devkit tee to it.
 *
 * Every root surface (`scripts/lane.js` per lane, `scripts/watch-all.js`) writes
 * its FULL output to `.temp/logs/<label>.log`: the terminal keeps its colors,
 * the file gets ANSI-stripped lines, and a new launch truncates the old file
 * (the ruled retention — no history kept). Grep the file instead of re-running
 * the surface.
 *
 * A label may carry characters a filesystem dislikes (`test:packages`), so it
 * maps to a safe, predictable name: `test-packages.log`.
 */

// Libraries
const path = require('path');
const attachLogFile = require('@omega.js/devkit/attach-log-file');

// Constants
const LOG_DIR = path.join(__dirname, '..', '.temp', 'logs');

/**
 * Where a surface's log lands.
 * @param {string} label - the lane label / surface name
 * @returns {string} absolute log path
 */
function logFilePath(label) {
  const safe = String(label).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return path.join(LOG_DIR, `${safe}.log`);
}

/**
 * Start teeing this process's stdout + stderr to the surface's log file.
 * Skipped in CI by the devkit tee (a runner captures its own output).
 * @param {string} label - the lane label / surface name
 * @returns {Function} detach
 */
function teeLog(label) {
  return attachLogFile(logFilePath(label));
}

module.exports = { logFilePath, teeLog };

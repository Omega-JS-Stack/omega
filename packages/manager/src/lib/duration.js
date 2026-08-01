/**
 * Wall-clock formatting for the manage walk — the ONE duration renderer the
 * per-service lines and the run summary's total share.
 *
 *   formatDuration(340)    → '340ms'
 *   formatDuration(14_200) → '14s'
 *   formatDuration(94_000) → '1m 34s'
 */

/**
 * Format elapsed milliseconds for humans.
 *
 * @param {number} ms - Elapsed milliseconds
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const seconds = Math.floor(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

module.exports = { formatDuration };

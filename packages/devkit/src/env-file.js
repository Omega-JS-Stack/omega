/**
 * The env file's ONE name: every layer's base file (company, brand, target),
 * the backend stage's composed `dist/.env`, a runner's own `.env`, and the
 * marker engine's `.env` flavor all spell it through here.
 *
 * Stdlib-only (no imports at all), so every host can vendor it and
 * @omega.js/config can require it with no cycle.
 */

/**
 * The env file's name.
 *
 * @type {string}
 */
const ENV_FILE = '.env';

module.exports = { ENV_FILE };

/**
 * The ONE JSON writer: two-space indent and one trailing newline, so every
 * manifest, lock and record the family writes ends the way editors and git
 * expect. A writer that calls JSON.stringify itself is a defect.
 */

const jetpack = require('fs-jetpack');

/**
 * The exact text `writeJson` puts on disk, for a caller that compares before
 * it writes (an idempotent writer leaves a settled file alone).
 *
 * @param {*} value - What to serialize.
 * @returns {string} Two-space JSON plus one trailing newline.
 */
function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Write `value` to `file` as formatted JSON.
 *
 * @param {string} file - Where to write.
 * @param {*} value - What to write.
 * @param {object} [options] - fs-jetpack's write options: `mode`, applied when
 *   the file is created.
 * @returns {void}
 */
function writeJson(file, value, options) {
  jetpack.write(file, formatJson(value), options);
}

module.exports = { writeJson, formatJson };

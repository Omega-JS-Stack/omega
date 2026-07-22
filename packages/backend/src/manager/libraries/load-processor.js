/**
 * Safe dynamic processor loader — the ONE way to require a processor module by name.
 *
 * Confines the require() to the given processors directory: names are strictly
 * lowercase [a-z0-9-], so a caller-controlled value can never traverse out
 * (`../`, absolute paths, or dots are rejected before any path math happens).
 */
const path = require('path');

const NAME_PATTERN = /^[a-z0-9-]+$/;
const ID_PATTERN = /^[a-z0-9_-]+(?::[a-z0-9_-]+)*$/;

/**
 * Load `${dir}/${name}.js`, rejecting any name that could escape the directory.
 *
 * @param {string} dir - Absolute path of the processors directory
 * @param {string} name - Processor name (strictly [a-z0-9-])
 * @returns {*} The required module
 * @throws {Error} When the name is not a valid processor name
 */
function loadProcessor(dir, name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(`Invalid processor name: ${name}`);
  }

  return require(path.join(dir, `${name}.js`));
}

/**
 * Load a module by colon-joined id (e.g. "general:download-app-link"), rejecting
 * any id that could escape the directory: every segment is strictly [a-z0-9_-].
 *
 * @param {string} dir - Absolute path of the modules directory
 * @param {string} id - Colon-joined module id
 * @param {object} [options] - `flat: true` keeps the colon-joined id as the literal filename instead of mapping colons to nested folders
 * @returns {*} The required module
 * @throws {Error} When the id is not a valid module id
 */
function loadTemplate(dir, id, options) {
  options = options || {};

  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`Invalid template id: ${id}`);
  }

  const relative = options.flat ? id : id.split(':').join('/');

  return require(path.join(dir, `${relative}.js`));
}

module.exports = loadProcessor;
module.exports.loadTemplate = loadTemplate;

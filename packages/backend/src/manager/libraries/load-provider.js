/**
 * Safe dynamic provider loader — the ONE way to require a provider module by name.
 *
 * Confines the require() to the given providers directory: names are strictly
 * lowercase [a-z0-9-], so a caller-controlled value can never traverse out
 * (`../`, absolute paths, or dots are rejected before any path math happens).
 */
const path = require('path');

const NAME_PATTERN = /^[a-z0-9-]+$/;
const ID_PATTERN = /^[a-z0-9_-]+(?::[a-z0-9_-]+)*$/;

/**
 * The file `${dir}/${name}.js` resolves to, rejecting any name that could
 * escape the directory. Split out of loadProvider so a caller that searches
 * SEVERAL directories (the connections lane: the brand's dir, then the package's)
 * can ask whether a file is there without owning a second copy of the name
 * rule ([#771](https://github.com/Omega-JS-Stack/omega/issues/771)).
 *
 * @param {string} dir - Absolute path of the providers directory
 * @param {string} name - Provider name (strictly [a-z0-9-])
 * @returns {string} Absolute path of the provider file
 * @throws {Error} When the name is not a valid provider name
 */
function providerPath(dir, name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(`Invalid provider name: ${name}`);
  }

  return path.join(dir, `${name}.js`);
}

/**
 * Load `${dir}/${name}.js`, rejecting any name that could escape the directory.
 *
 * @param {string} dir - Absolute path of the providers directory
 * @param {string} name - Provider name (strictly [a-z0-9-])
 * @returns {*} The required module
 * @throws {Error} When the name is not a valid provider name
 */
function loadProvider(dir, name) {
  return require(providerPath(dir, name));
}

/**
 * Load a module by colon-joined id (e.g. "general:download-app-link" →
 * `${dir}/general/download-app-link.js`), rejecting any id that could escape
 * the directory: every segment is strictly [a-z0-9_-].
 *
 * @param {string} dir - Absolute path of the modules directory
 * @param {string} id - Colon-joined module id
 * @returns {*} The required module
 * @throws {Error} When the id is not a valid module id
 */
function loadTemplate(dir, id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`Invalid template id: ${id}`);
  }

  return require(path.join(dir, `${id.split(':').join('/')}.js`));
}

module.exports = loadProvider;
module.exports.providerPath = providerPath;
module.exports.loadTemplate = loadTemplate;

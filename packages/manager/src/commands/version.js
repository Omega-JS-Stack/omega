/**
 * `omega-manager version` — print the package version.
 */
const pkg = require('../../package.json');

module.exports = async () => {
  console.log(`${pkg.name} v${pkg.version}`);
};

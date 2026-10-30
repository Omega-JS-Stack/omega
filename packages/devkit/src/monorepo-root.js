/**
 * Is a directory the omega monorepo root? The ONE answer, stdlib-only so the
 * prepare gate can ask it in a checkout that has installed nothing yet.
 */

const fs = require('fs');
const path = require('path');

/**
 * Check whether a directory is the Omega monorepo root (package.json named
 * "omega" and a packages/devkit workspace).
 * @param {string} dir - Directory to test.
 * @returns {boolean}
 */
function isMonorepoRoot(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return pkg.name === 'omega' && fs.existsSync(path.join(dir, 'packages', 'devkit', 'package.json'));
  } catch (e) {
    return false;
  }
}

module.exports = { isMonorepoRoot };

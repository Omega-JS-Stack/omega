/**
 * Clean build-output directories: remove each one and recreate it empty.
 *
 * `rm -rf` on Unix for speed; fs-jetpack on Windows (no rm there, and
 * jetpack.remove retries transient locks). Relative paths resolve against
 * process.cwd(), same as the framework clean commands that call this.
 */

const { execSync } = require('child_process');
const jetpack = require('fs-jetpack');

/**
 * Remove and recreate each directory, leaving them empty.
 * @param {string[]} dirs - Directories to clean (relative or absolute).
 */
function cleanDirs(dirs) {
  for (const dir of dirs) {
    if (process.platform !== 'win32') {
      execSync(`rm -rf '${dir}'`, { stdio: 'ignore' });
    } else {
      jetpack.remove(dir);
    }

    jetpack.dir(dir);
  }
}

module.exports = { cleanDirs };

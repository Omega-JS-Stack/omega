/**
 * Resolve a framework's `omega` bin FILE via the node_modules directory climb
 * from where the target declares it. A manual walk (not require.resolve) because
 * exports-restricted packages don't expose ./package.json. Shared by the
 * brand-root fan-out commands (`omega test`, `omega deploy`).
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} fromDir - Directory to climb from (where the dep is declared)
 * @param {string} name - Framework package name ('@omega.js/web', …)
 * @returns {string|null} - Absolute bin path, or null when not installed
 */
function resolveFrameworkBin(fromDir, name) {
  let dir = path.resolve(fromDir);

  while (true) {
    const pkgDir = path.join(dir, 'node_modules', name);
    const pkgPath = path.join(pkgDir, 'package.json');

    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin || {}).omega;
      return bin ? path.join(pkgDir, bin) : null;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

module.exports = { resolveFrameworkBin };

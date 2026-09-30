/**
 * The path of a framework doc, for a shipped TEST file that reads one.
 *
 * In the monorepo the doc is in the top-level docs/ tree. In a brand, the
 * installed @omega.js/manager ships that same tree as its docs/, so a
 * framework suite run from node_modules reads the manager's copy.
 * (Underscore-prefixed: the runner skips _ files in discovery.)
 */
const fs = require('fs');
const path = require('path');

/**
 * @param {...string} parts - The doc's path inside docs/ ('backend', 'routes.md')
 * @returns {string} - Absolute path of the doc
 */
function frameworkDoc(...parts) {
  const monorepoDoc = path.join(__dirname, '..', '..', '..', '..', 'docs', ...parts);
  if (fs.existsSync(monorepoDoc)) {
    return monorepoDoc;
  }
  // The manager's main is dist/index.js, so its package root is two levels up.
  const managerRoot = path.dirname(path.dirname(require.resolve('@omega.js/manager', { paths: [__dirname] })));
  return path.join(managerRoot, 'docs', ...parts);
}

module.exports = { frameworkDoc };

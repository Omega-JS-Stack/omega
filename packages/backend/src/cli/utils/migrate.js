/**
 * migrateTarget: the backend leg of the brand root's `omega migrate`, the
 * ported-project REPORT. Its one finding class is the dependency-resolution
 * scan: BEM's FLAT install answered a route's bare `require('fs-jetpack')`, an
 * OMEGA install answers it only by HOISTING, and those requires are LAZY, so
 * the module loads and the route 500s on the first real request. REPORT ONLY,
 * `execute` included: which version a brand wants is the brand's call. The
 * scan is devkit's, the SAME one the web leg runs; a backend has no bundler,
 * so it excludes no aliases. The one-time CONVERSIONS stay run-alone verbs
 * (`migrate:rules`, `migrate:markers`): those change what the project enforces.
 */
const { collectBareRequires, formatBareRequire } = require('@omega.js/devkit/bare-requires');

/**
 * @param {string} targetDir - the backend target's root
 * @param {object} [options]
 * @param {boolean} [options.execute] - asked to convert; this leg still only reports
 * @returns {{ due: string[], changed: string[], errors: string[] }}
 */
function migrateTarget(targetDir, options = {}) {
  const due = collectBareRequires(targetDir).map(formatBareRequire);

  if (options.execute === true && due.length > 0) {
    due.push('--execute installs nothing here: declare each package above in this target\'s package.json by hand');
  }

  return { due, changed: [], errors: [] };
}

module.exports = { migrateTarget };

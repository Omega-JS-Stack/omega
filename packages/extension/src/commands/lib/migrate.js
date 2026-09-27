/**
 * migrateTarget: the extension leg of the brand root's `omega migrate`, the
 * one-time, version-gated moves a legacy consumer needs. A MOVE is not
 * idempotent healing, so it rides the deliberate verb and never ensureTarget.
 *
 * Today it carries one: flat hook files into the nested layout of 2.0.0.
 * Report only by default (`due` names each move); `execute` moves them
 * (`changed`). A `file:` install is skipped: a linked consumer is already current.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const version = require('wonderful-version');
const { readProject } = require('./dependencies.js');
const { name: FRAMEWORK } = require('../../../package.json');

// Old hook file name → its new nested path
const HOOK_MIGRATIONS = [
  { old: 'build:post.js', new: 'build/post.js' },
  { old: 'build:pre.js', new: 'build/pre.js' },
  { old: 'middleware:request.js', new: 'middleware/request.js' },
];

/**
 * @param {string} targetDir - the extension target's root
 * @param {object} [options]
 * @param {boolean} [options.execute] - move the files (default: report only)
 * @returns {{ due: string[], changed: string[], errors: string[] }}
 */
function migrateTarget(targetDir, options = {}) {
  const execute = options.execute === true;
  const result = { due: [], changed: [], errors: [] };

  const project = readProject(targetDir);
  const installedVersion = project.devDependencies[FRAMEWORK] || project.dependencies[FRAMEWORK] || '0.0.0';

  // A linked consumer builds from THIS source, so there is nothing to migrate to
  if (installedVersion.startsWith('file:') || !version.is(installedVersion, '<=', '2.0.0')) {
    return result;
  }

  for (const migration of HOOK_MIGRATIONS) {
    const oldPath = path.join(targetDir, 'hooks', migration.old);
    const newPath = path.join(targetDir, 'hooks', migration.new);
    if (!jetpack.exists(oldPath)) continue;

    const move = `hooks/${migration.old} to hooks/${migration.new}${jetpack.exists(newPath) ? ', overwriting the file already there' : ''}`;
    if (!execute) {
      result.due.push(`move ${move}`);
      continue;
    }

    jetpack.move(oldPath, newPath, { overwrite: true });
    result.changed.push(`moved ${move}`);
  }

  return result;
}

module.exports = { migrateTarget, HOOK_MIGRATIONS };

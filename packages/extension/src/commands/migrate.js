/**
 * `omega migrate` — the one-time, version-gated moves an upgrade needs.
 *
 * This used to be step one of `omega setup` and ran on every setup. Setup is
 * retired ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)) and its
 * local half now runs on every verb, which is the wrong home for a migration:
 * a MOVE is not idempotent healing, it is a one-time upgrade step a consumer
 * runs deliberately (the same shape `@omega.js/web` already ships).
 *
 * Today it carries one migration: hook files moved to the nested layout in
 * 2.0.0. A `file:` install is skipped — a linked consumer is already current.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const version = require('wonderful-version');
const Manager = new (require('../build.js'));
const { readProject } = require('./lib/dependencies.js');

const logger = Manager.logger('migrate');
const package = Manager.getPackage('main');

// Old hook file name → its new nested path
const HOOK_MIGRATIONS = [
  { old: 'build:post.js', new: 'build/post.js' },
  { old: 'build:pre.js', new: 'build/pre.js' },
  { old: 'middleware:request.js', new: 'middleware/request.js' },
];

/** Move old flat hook files into the nested structure (introduced in 2.0.0). */
function migrateHooksToNestedStructure(projectDir) {
  const hooksDir = path.join(projectDir, 'hooks');
  let migratedCount = 0;

  for (const migration of HOOK_MIGRATIONS) {
    const oldPath = path.join(hooksDir, migration.old);
    const newPath = path.join(hooksDir, migration.new);

    if (!jetpack.exists(oldPath)) {
      continue;
    }

    if (jetpack.exists(newPath)) {
      logger.warn(`⚠️  Migrate ${migration.old}: ${migration.new} already exists`);
    }

    jetpack.move(oldPath, newPath, { overwrite: true });
    logger.log(`✅ Migrated hook: ${migration.old} → ${migration.new}`);
    migratedCount++;
  }

  if (migratedCount > 0) {
    logger.log(`✅ Migrated ${migratedCount} hook file(s) to new nested structure`);
  }

  return migratedCount;
}

module.exports = async function (options) {
  options = options || {};

  const projectDir = options.projectDir || Manager.getRootPath('project');
  const project = readProject(projectDir);
  const installedVersion = project.devDependencies[package.name] || project.dependencies[package.name] || '0.0.0';

  // A linked consumer builds from THIS source — there is nothing to migrate to.
  if (installedVersion.startsWith('file:')) {
    return logger.log('Local (`file:`) install — nothing to migrate.');
  }

  if (version.is(installedVersion, '<=', '2.0.0')) {
    migrateHooksToNestedStructure(projectDir);
  }

  logger.log('Migration complete');
};

module.exports.migrateHooksToNestedStructure = migrateHooksToNestedStructure;

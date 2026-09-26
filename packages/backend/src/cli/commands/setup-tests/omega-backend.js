const path = require('path');
const BaseTest = require('./base-test');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const wonderfulVersion = require('wonderful-version');
const powertools = require('node-powertools');
const { getLatestVersion } = require('@omega.js/devkit/npm-registry');
const { resolvePackageRealDir, isLocalCheckout, isMonorepoRoot } = require('@omega.js/devkit/local');

const PKG = '@omega.js/backend';

/**
 * The @omega.js/backend this target RESOLVES vs the npm latest.
 *
 * Resolution answers the question, never the manifest: the node_modules
 * walk-up from the target finds the copy Node would load, so workspace
 * hoisting and file: links both count, and a stale manifest pin says nothing
 * (docs/shared/local-dev.md). A copy that is a checkout inside a monorepo
 * passes whatever the manifest pins: it IS the working tree. A registry copy
 * passes at or above latest; a major gap passes with a red line (majors are
 * installed by hand). Behind latest, or not resolved at all, is a WARN naming
 * `npx omega update`: the one updater (docs/shared/updates.md). This check
 * never installs and never exits, so the run it sits in continues.
 */
class OmegaBackendTest extends BaseTest {
  getName() {
    return `using updated ${PKG}`;
  }

  async run() {
    this._warning = null;
    const realDir = resolvePackageRealDir(PKG, this.self.firebaseProjectPath);

    // Nothing resolves from the target: report it, installing is not this check's job
    if (!realDir) {
      this._warning = `${PKG} does not resolve from this target. Run ${chalk.bold('npx omega update')}.`;
      return 'warn';
    }

    // <root>/packages/backend of a monorepo checkout: the working tree is the version
    if (isLocalCheckout(realDir) && isMonorepoRoot(path.dirname(path.dirname(realDir)))) {
      return true;
    }

    const resolved = jetpack.read(path.join(realDir, 'package.json'), 'json').version;
    const latest = await this.getPkgVersion(PKG);

    if (wonderfulVersion.is(resolved, '>=', latest)) {
      return true;
    }

    // A major jump is a breaking upgrade: flag it, never block on it
    if (wonderfulVersion.levelDifference(latest, resolved) === 'major') {
      console.log(chalk.red(`Version ${chalk.bold(latest)} of ${chalk.bold(PKG)} available but you must install this manually because it is a major update.`));
      return true;
    }

    this._warning = `${PKG} ${resolved} resolves here but ${latest} is the latest. Run ${chalk.bold('npx omega update')}.`;
    return 'warn';
  }

  getWarning() {
    return this._warning ? [this._warning] : [];
  }

  async getPkgVersion(packageName) {
    return (await getLatestVersion(packageName)) || '0.0.0';
  }
}

module.exports = OmegaBackendTest;

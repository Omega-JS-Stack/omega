const BaseTest = require('./base-test');
const chalk = require('chalk').default;
const wonderfulVersion = require('wonderful-version');
const powertools = require('node-powertools');
const helpers = require('./helpers');

class FirebaseFunctionsTest extends BaseTest {
  getName() {
    return 'using updated firebase-functions';
  }

  async run() {
    const pkg = 'firebase-functions';
    const latest = this.context.packageJSON.peerDependencies['firebase-functions'];
    const mine = this.context.package.dependencies[pkg];
    const bemv = this.context.packageJSON.peerDependencies[pkg];

    // Not in package.json at all — must install
    if (!mine) {
      return false;
    }

    // Get level difference
    const levelDifference = wonderfulVersion.levelDifference(latest, mine);

    // Log
    this.bemPackageVersionWarning(pkg, bemv, latest);

    // Log if major version mismatch
    if (levelDifference === 'major') {
      console.log(chalk.red(`Version ${chalk.bold(latest)} of ${chalk.bold(pkg)} available but you must install this manually because it is a major update.`));
    }

    // Ensure the version is up to date
    return wonderfulVersion.is(mine, '>=', latest) || levelDifference === 'major';
  }

  async fix() {
    await this.installPkg('firebase-functions', `@${this.context.packageJSON.peerDependencies['firebase-functions']}`);
  }

  bemPackageVersionWarning(packageName, current, latest) {
    if (wonderfulVersion.greaterThan(latest, current)) {
      console.log(chalk.yellow(`${packageName} needs to be updated in @omega.js/backend: ${current} => ${latest}`));
    }
  }
}

module.exports = FirebaseFunctionsTest;

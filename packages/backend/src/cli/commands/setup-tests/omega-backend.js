const BaseTest = require('./base-test');
const chalk = require('chalk').default;
const wonderfulVersion = require('wonderful-version');
const powertools = require('node-powertools');
const Npm = require('npm-api');
const helpers = require('./helpers');
const { safeInstall } = require('../../utils/safe-install');

class OmegaBackendTest extends BaseTest {
  getName() {
    return 'using updated @omega.js/backend';
  }

  async run() {
    const pkg = '@omega.js/backend';
    const latest = await this.getPkgVersion(pkg);
    const mine = this.context.package.dependencies[pkg];

    // Get level difference
    const levelDifference = wonderfulVersion.levelDifference(latest, mine);

    // Log if major version mismatch
    if (!helpers.isLocal(mine) && levelDifference === 'major') {
      console.log(chalk.red(`Version ${chalk.bold(latest)} of ${chalk.bold(pkg)} available but you must install this manually because it is a major update.`));
    }

    // Ensure the version is up to date
    return helpers.isLocal(mine) || wonderfulVersion.is(mine, '>=', latest) || levelDifference === 'major';
  }

  async fix() {
    await this.installPkg('@omega.js/backend');

    console.log(chalk.green(`Process has exited since a new version of @omega.js/backend was installed. Run ${chalk.bold('npx bm setup')} again.`));
    process.exit(0);
  }

  async getPkgVersion(packageName) {
    const npm = new Npm();

    return new Promise((resolve, reject) => {
      npm.repo(packageName)
        .package()
        .then(function(pkg) {
          resolve(pkg.version);
        }, function(err) {
          resolve('0.0.0');
        });
    });
  }

  async installPkg(name, version, type) {
    let v;
    let t;
    if (name.indexOf('file:') > -1) {
      v = '';
    } else if (!version) {
      v = '@latest';
    } else {
      v = version;
    }

    if (!type) {
      t = '';
    } else if (type === 'dev' || type === '--save-dev') {
      t = ' --save-dev';
    }

    // Build the command
    const command = `npm i ${name}${v}${t}`;

    // Log
    console.log('Running ', command);

    // Execute at the APP ROOT — runtime deps live on the app manifest
    // (src/dist pillar), never inside the staged functions/ tree
    await safeInstall(command, { log: true, config: { cwd: this.self.firebaseProjectPath } });
  }
}

module.exports = OmegaBackendTest;

const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const wonderfulVersion = require('wonderful-version');

class NvmrcVersionTest extends BaseTest {
  getName() {
    return '.nvmrc file has proper version';
  }

  async run() {
    // Authored at the APP ROOT (src/dist pillar); the stage step carries a
    // copy into functions/ for firebase-tools' runtime detection. Compared
    // against the pinned Cloud Functions runtime (omega.functionsRuntime),
    // NOT engines.node — engines is the dev floor (>=22), not a version.
    const runtimeVer = this.context.packageJSON.omega.functionsRuntime;
    const nvmrcVer = jetpack.read(`${this.self.firebaseProjectPath}/.nvmrc`);

    // Check to ensure nvmrc is greater than or equal to the runtime version
    return wonderfulVersion.is(nvmrcVer, '>=', runtimeVer);
  }

  async fix() {
    const v = this.context.packageJSON.omega.functionsRuntime;

    jetpack.write(`${this.self.firebaseProjectPath}/.nvmrc`, `v${v}/*`);
    this.restage();

    // #15: the pin is now correct — the fix IS complete and the run
    // continues (manage runs spawn setup under the app's own Node; only a
    // standalone shell needs the nvm switch, for NEXT time).
    console.log(chalk.yellow(`.nvmrc pinned to v${v}/* — standalone shells: run ${chalk.bold(`nvm use ${v}`)}`));
  }
}

module.exports = NvmrcVersionTest;

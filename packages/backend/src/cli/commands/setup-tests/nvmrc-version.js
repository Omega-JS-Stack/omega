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
    // copy into functions/ for firebase-tools' runtime detection
    const engineReqVer = this.context.packageJSON.engines.node;
    const nvmrcVer = jetpack.read(`${this.self.firebaseProjectPath}/.nvmrc`);

    // Check to ensure nvmrc is greater than or equal to the engine version
    return wonderfulVersion.is(nvmrcVer, '>=', engineReqVer);
  }

  async fix() {
    const v = this.context.packageJSON.engines.node;

    jetpack.write(`${this.self.firebaseProjectPath}/.nvmrc`, `v${v}/*`);
    this.restage();

    // #15: the pin is now correct — the fix IS complete and the run
    // continues (manage runs spawn setup under the app's own Node; only a
    // standalone shell needs the nvm switch, for NEXT time).
    console.log(chalk.yellow(`.nvmrc pinned to v${v}/* — standalone shells: run ${chalk.bold(`nvm use ${v}`)}`));
  }
}

module.exports = NvmrcVersionTest;

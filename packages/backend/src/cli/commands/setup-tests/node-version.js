const BaseTest = require('./base-test');
const chalk = require('chalk').default;
const wonderfulVersion = require('wonderful-version');

class NodeVersionTest extends BaseTest {
  getName() {
    return `using at least Node.js v${this.context.packageJSON.engines.node}`;
  }

  async run() {
    const engineReqVer = this.context.packageJSON.engines.node;
    const engineHasVer = this.context.package.engines.node;
    const processVer = process.versions.node;

    // #15: a wrong RUNNING Node no longer halts the whole setup — the
    // remaining checks complete and this lands in the summary as a warning
    // (manage runs spawn setup under the app's own .nvmrc Node, so this
    // fires mostly in standalone shells).
    if (wonderfulVersion.is(processVer, '<', engineReqVer)) {
      this._warning = `running Node ${processVer} but this project needs ${engineReqVer} — run ${chalk.bold(`nvm use ${engineReqVer}`)}`;
      return 'warn';
    }

    // Check if the engine version is less than the required version
    if (!wonderfulVersion.is(engineHasVer, '===', engineReqVer)) {
      console.log(chalk.yellow(`You are using Node.js version ${processVer} but this project suggests ${engineReqVer}.`));
    }

    // Return
    return wonderfulVersion.is(engineHasVer, '>=', engineReqVer);
  }

  getWarning() {
    return this._warning ? [this._warning] : [];
  }

  async fix() {
    throw new Error('Please manually fix your outdated Node.js version (either .nvmrc or package.json engines.node).');
  }
}

module.exports = NodeVersionTest;

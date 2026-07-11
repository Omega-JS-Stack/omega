const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const { omegaAllRulesRegex } = require('./helpers.js');

class RealtimeRulesFileTest extends BaseTest {
  getName() {
    return 'update realtime rules file';
  }

  async run() {
    const self = this.self;
    const exists = jetpack.exists(`${self.firebaseProjectPath}/database.rules.json`);
    const contents = jetpack.read(`${self.firebaseProjectPath}/database.rules.json`) || '';
    const containsCore = contents.match(omegaAllRulesRegex);
    const matchesVersion = contents.match(self.default.rulesVersionRegex);

    return (exists && !!containsCore && !!matchesVersion);
  }

  async fix() {
    const self = this.self;
    const name = 'database.rules.json';
    const path = `${self.firebaseProjectPath}/${name}`;
    const exists = jetpack.exists(path);
    let contents = jetpack.read(path) || '';

    if (!exists || !contents) {
      console.log(chalk.yellow(`Writing new ${name} file...`));
      jetpack.write(path, self.default.databaseRulesWhole);
      contents = jetpack.read(path) || '';
    }

    const hasTemplate = contents.match(omegaAllRulesRegex);
    if (!hasTemplate) {
      console.log(chalk.red(`Could not find rules template. Please edit ${name} and add the ///---omega---/// ... ///---------end---------/// marker block to it.`));
      return;
    }

    const matchesVersion = contents.match(self.default.rulesVersionRegex);
    if (!matchesVersion) {
      contents = contents.replace(omegaAllRulesRegex, self.default.databaseRulesCore);
      jetpack.write(path, contents);
      console.log(chalk.yellow(`Writing core rules to ${name} file...`));
    }
  }
}

module.exports = RealtimeRulesFileTest;

const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const { omegaAllRulesRegex, legacyRulesPlaceholderRegex } = require('./helpers.js');

class FirestoreRulesFileTest extends BaseTest {
  getName() {
    return 'update firestore rules file';
  }

  async run() {
    const self = this.self;
    const exists = jetpack.exists(`${self.firebaseProjectPath}/firestore.rules`);
    const contents = jetpack.read(`${self.firebaseProjectPath}/firestore.rules`) || '';
    const containsCore = contents.match(omegaAllRulesRegex);
    const matchesVersion = contents.match(self.default.rulesVersionRegex);

    // Always run fix() to ensure rules are synced, even if version matches
    // This ensures the rules content is always up to date
    await this.fix();

    return (exists && !!containsCore && !!matchesVersion);
  }

  async fix() {
    const self = this.self;
    const name = 'firestore.rules';
    const path = `${self.firebaseProjectPath}/${name}`;
    const exists = jetpack.exists(path);
    let contents = jetpack.read(path) || '';

    if (!exists || !contents) {
      console.log(chalk.yellow(`Writing new ${name} file...`));
      jetpack.write(path, self.default.firestoreRulesWhole);
      contents = jetpack.read(path) || '';
    }

    const hasTemplate = contents.match(omegaAllRulesRegex) || contents.match(legacyRulesPlaceholderRegex);
    if (!hasTemplate) {
      console.log(chalk.red(`Could not find rules template. Please edit ${name} and add the ///---omega---/// ... ///---------end---------/// marker block to it.`));
      return;
    }

    // Always replace rules to ensure they're in sync with @omega.js/backend template
    const originalContents = contents;
    contents = contents.replace(legacyRulesPlaceholderRegex, self.default.firestoreRulesCore);
    contents = contents.replace(omegaAllRulesRegex, self.default.firestoreRulesCore);

    if (contents !== originalContents) {
      jetpack.write(path, contents);
      console.log(chalk.yellow(`Updated @omega.js/backend rules in ${name} file`));
    }
  }
}

module.exports = FirestoreRulesFileTest;

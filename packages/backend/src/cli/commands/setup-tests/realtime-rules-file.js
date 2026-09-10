const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const { omegaAllRulesRegex } = require('./helpers.js');
const { MARKER_MIGRATION_COMMAND, isPreFamilyMarkerFile, markerMigrationDeferralNotice } = require('../../utils/compile-rules');

class RealtimeRulesFileTest extends BaseTest {
  getName() {
    return 'update realtime rules file';
  }

  getWarning() {
    return markerMigrationDeferralNotice('database.rules.json');
  }

  async run() {
    const self = this.self;
    const exists = jetpack.exists(`${self.firebaseProjectPath}/database.rules.json`);
    const contents = jetpack.read(`${self.firebaseProjectPath}/database.rules.json`) || '';

    // A pre-family file DEFERS rather than failing: the driver auto-fixes a
    // failure, and this check's fix() can only refuse one
    // ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
    if (isPreFamilyMarkerFile(contents)) {
      return 'warn';
    }

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
      // A PRE-FAMILY file is not a missing marker block, it is an unreadable
      // one — and converting it is the run-alone verb's job, never setup's
      // ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
      if (isPreFamilyMarkerFile(contents)) {
        console.log(chalk.red(`${name} still carries a pre-family marker ('{{ backend-manager }}' or a '///---...---///' block), which this check does not speak. Run \`${MARKER_MIGRATION_COMMAND}\` to convert it, then run this again.`));
        return;
      }
      console.log(chalk.red(`Could not find rules template. Please edit ${name} and add the '// ========== OMEGA Rules (v0.0.0) ==========' ... '// ========== End OMEGA Rules ==========' marker block to it.`));
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

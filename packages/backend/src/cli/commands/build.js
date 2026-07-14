const BaseCommand = require('./base-command');
const chalk = require('chalk').default;
const { stageFunctions } = require('../utils/stage-functions');

/**
 * `omega build` — stage the authored app tree (src/, manifest, config layers,
 * .env, service account) into functions/, the generated output every runtime
 * surface reads (emulator, serve, test, deploy). The backend's equivalent of
 * the other targets' src→dist build; see src/cli/utils/stage-functions.js.
 */
class BuildCommand extends BaseCommand {
  async execute() {
    const self = this.main;

    const { staged } = stageFunctions({ projectDir: self.firebaseProjectPath });

    this.log(chalk.bold('\n  Staged functions/ from the authored tree:'));
    for (const step of staged) {
      this.log(`  ${chalk.green('✓')} ${step}`);
    }
    this.log('');
  }
}

module.exports = BuildCommand;

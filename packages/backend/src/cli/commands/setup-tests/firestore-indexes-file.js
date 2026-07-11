const path = require('path');
const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

class FirestoreIndexesFileTest extends BaseTest {
  getName() {
    return 'update firestore indexes file';
  }

  async run() {
    const self = this.self;
    const filePath = `${self.firebaseProjectPath}/firestore.indexes.json`;

    if (!jetpack.exists(filePath)) {
      return false;
    }

    // A file that isn't JSON is a poisoned artifact (the pre-fix live pull
    // shell-redirected 403 error text into it — friction #8) and breaks every
    // later consumer; treat it as missing so the fix rewrites it.
    try {
      JSON.parse(jetpack.read(filePath));
      return true;
    } catch (e) {
      console.log(chalk.yellow(`  ${filePath} is not valid JSON (poisoned by a failed live pull?) — rewriting`));
      return false;
    }
  }

  async fix() {
    const self = this.self;
    const name = 'firestore.indexes.json';
    const filePath = `${self.firebaseProjectPath}/${name}`;

    // Clear a poisoned (unparseable) file so both paths below rewrite it.
    let exists = jetpack.exists(filePath);
    if (exists) {
      try {
        JSON.parse(jetpack.read(filePath));
      } catch (e) {
        jetpack.remove(filePath);
        exists = false;
      }
    }

    if (!exists) {
      console.log(chalk.yellow(`Writing new ${name} file...`));

      // demo-* projects are emulator-only — there is no live project to pull
      // indexes from (friction #8's second head: this fix used the same
      // shell-redirect that poisons the file with the 403 text). Seed the
      // template's empty shape; the emulator needs no composite indexes.
      if (this.isDemoProject) {
        jetpack.copy(path.resolve(__dirname, '../../../../templates', name), filePath);
        return;
      }

      const commands = require('../index');
      const IndexesCommand = commands.IndexesCommand;
      const indexesCmd = new IndexesCommand(self);

      await indexesCmd.get(name, false);
    }
  }
}

module.exports = FirestoreIndexesFileTest;

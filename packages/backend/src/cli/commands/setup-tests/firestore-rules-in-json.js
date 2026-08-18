const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const _ = require('lodash');
const { COMPILED_RULES_FILE } = require('../../utils/compile-rules');

/**
 * firebase.json points at the COMPILED artifact, never the brand's source
 * ([#255](https://github.com/Omega-JS-Stack/omega/issues/255)) — one path for
 * both the emulator and `firebase deploy`. Retargeting a legacy
 * `"firestore.rules"` entry is the migration's other half.
 */
class FirestoreRulesInJsonTest extends BaseTest {
  getName() {
    return 'firestore rules in JSON';
  }

  async run() {
    return this.self.firebaseJSON?.firestore?.rules === COMPILED_RULES_FILE;
  }

  async fix() {
    _.set(this.self.firebaseJSON, 'firestore.rules', COMPILED_RULES_FILE);
    jetpack.write(`${this.self.firebaseProjectPath}/firebase.json`, JSON.stringify(this.self.firebaseJSON, null, 2));
  }
}

module.exports = FirestoreRulesInJsonTest;

const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const _ = require('lodash');
const {
  COMPILED_RULES_FILE,
  deferredRulesTarget,
  rulesMigrationDeferralNotice,
} = require('../../utils/compile-rules');

/**
 * firebase.json points at the COMPILED artifact, never the brand's source
 * ([#255](https://github.com/Omega-JS-Stack/omega/issues/255)) — one path for
 * both the emulator and `firebase deploy`.
 *
 * Retargeting a legacy `"firestore.rules"` entry is the migration's other half,
 * and it is NOT this check's to do: repointing the deploy at the compiled
 * artifact changes what the live project enforces, so a brand still naming its
 * own file has DEFERRED the migration and the check reports it instead
 * ([#522](https://github.com/Omega-JS-Stack/omega/issues/522)).
 */
class FirestoreRulesInJsonTest extends BaseTest {
  getName() {
    return 'firestore rules in JSON';
  }

  getWarning() {
    return rulesMigrationDeferralNotice(this.deferredTarget);
  }

  async run() {
    this.deferredTarget = deferredRulesTarget({
      projectDir: this.self.firebaseProjectPath,
      firebaseJSON: this.self.firebaseJSON,
    });

    if (this.deferredTarget) {
      return 'warn';
    }

    return this.self.firebaseJSON?.firestore?.rules === COMPILED_RULES_FILE;
  }

  async fix() {
    _.set(this.self.firebaseJSON, 'firestore.rules', COMPILED_RULES_FILE);
    jetpack.write(`${this.self.firebaseProjectPath}/firebase.json`, JSON.stringify(this.self.firebaseJSON, null, 2));
  }
}

module.exports = FirestoreRulesInJsonTest;

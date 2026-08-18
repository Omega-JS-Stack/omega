const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const {
  BRAND_RULES_FILE,
  COMPILED_RULES_FILE,
  compileFirestoreRules,
  ensureBrandRulesSource,
  isLegacyMarkerFile,
  missingBrandHooks,
} = require('../../utils/compile-rules');

/**
 * The brand's `firestore.rules` is SOURCE now, not a managed block
 * ([#255](https://github.com/Omega-JS-Stack/omega/issues/255)): setup seeds it
 * once, converts a legacy marker-block file ONCE, and lints that both framework
 * hooks are present — re-seeding a missing one loudly. The deployed artifact is
 * `dist/firestore.rules`, compiled by every stage.
 */
class FirestoreRulesFileTest extends BaseTest {
  getName() {
    return 'compile firestore rules';
  }

  async run() {
    const self = this.self;
    const contents = jetpack.read(`${self.firebaseProjectPath}/${BRAND_RULES_FILE}`) || '';

    if (!contents.trim() || isLegacyMarkerFile(contents)) {
      return false;
    }

    // An unparseable file fails the check and lets fix() throw with the
    // compiler's precise message — setup must never quietly rewrite rules it
    // could not read.
    try {
      if (missingBrandHooks(contents).length) {
        return false;
      }
    } catch (error) {
      return false;
    }

    // The artifact is stage output — a source-only pass still has to leave a
    // current compile behind (setup's own stage ran before this check).
    compileFirestoreRules({ projectDir: self.firebaseProjectPath });

    return jetpack.exists(`${self.firebaseProjectPath}/${COMPILED_RULES_FILE}`) === 'file';
  }

  async fix() {
    const self = this.self;
    const result = ensureBrandRulesSource({ projectDir: self.firebaseProjectPath });

    if (result.created) {
      console.log(chalk.yellow(`Seeded ${BRAND_RULES_FILE} — your rules plus the framework hooks. It is yours to edit.`));
    }
    if (result.migrated) {
      console.log(chalk.yellow(`Converted ${BRAND_RULES_FILE} off the legacy OMEGA Rules marker block — your custom rules were kept, the managed block now compiles in from @omega.js/backend.`));
    }
    for (const hook of result.reseeded) {
      console.log(chalk.red(`${BRAND_RULES_FILE} was missing the required \`${hook}()\` hook — re-seeded with its default. Review it: the framework's user-doc write rule calls it.`));
    }

    compileFirestoreRules({ projectDir: self.firebaseProjectPath });
  }
}

module.exports = FirestoreRulesFileTest;

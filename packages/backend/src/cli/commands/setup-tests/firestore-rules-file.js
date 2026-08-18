const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const {
  BRAND_RULES_FILE,
  COMPILED_RULES_FILE,
  compileFirestoreRules,
  ensureBrandRulesSource,
  needsRulesMigration,
} = require('../../utils/compile-rules');

/**
 * The brand's `firestore.rules` is SOURCE, not a managed block
 * ([#255](https://github.com/Omega-JS-Stack/omega/issues/255)): setup seeds it
 * once and migrates an older one ONCE — a legacy marker-block file, or a v2
 * hook-era file whose retired hooks merge-by-match replaced
 * ([#353](https://github.com/Omega-JS-Stack/omega/issues/353)). The deployed
 * artifact is `dist/firestore.rules`, compiled by every stage.
 */
class FirestoreRulesFileTest extends BaseTest {
  getName() {
    return 'compile firestore rules';
  }

  async run() {
    const self = this.self;
    const contents = jetpack.read(`${self.firebaseProjectPath}/${BRAND_RULES_FILE}`) || '';

    // An unparseable file fails the check and lets fix() throw with the
    // compiler's precise message — setup must never quietly rewrite rules it
    // could not read.
    try {
      if (needsRulesMigration(contents)) {
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
      console.log(chalk.yellow(`Seeded ${BRAND_RULES_FILE} — your rules, compiled with the framework half. It is yours to edit.`));
    }
    if (result.migrated) {
      console.log(chalk.yellow(`Migrated ${BRAND_RULES_FILE} to rules v3 (merge-by-match) — your own rules were kept, and a match block of yours that names a framework path now MERGES into it instead of sitting beside it.`));
    }
    for (const hook of result.strippedHooks) {
      console.log(chalk.yellow(`Removed the retired \`${hook}()\` hook from ${BRAND_RULES_FILE} — it still carried the default body, and nothing calls it any more.`));
    }
    for (const hook of result.keptHooks) {
      console.log(chalk.red(`${BRAND_RULES_FILE}: the retired \`${hook}()\` hook carried YOUR code, so it was kept as an ordinary function — but NOTHING CALLS IT NOW. Move what it enforced into a \`match\` block of your own (it merges into the framework's), then delete it.`));
    }

    compileFirestoreRules({ projectDir: self.firebaseProjectPath });
  }
}

module.exports = FirestoreRulesFileTest;

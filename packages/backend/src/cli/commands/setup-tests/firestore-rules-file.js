const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const {
  BRAND_RULES_FILE,
  COMPILED_RULES_FILE,
  RULES_MIGRATION_COMMAND,
  compileFirestoreRules,
  deferredRulesTarget,
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
 *
 * ONCE, but never behind a brand's back: while firebase.json still names the
 * brand's own file, that brand deploys the legacy posture deliberately and the
 * check DEFERS rather than rewriting the source under it
 * ([#522](https://github.com/Omega-JS-Stack/omega/issues/522)).
 */
class FirestoreRulesFileTest extends BaseTest {
  getName() {
    return 'compile firestore rules';
  }

  getWarning() {
    return [
      `${BRAND_RULES_FILE} was left untouched — the compiled-rules migration is deferred while firebase.json points at it.`,
      `Run it deliberately, on its own: ${RULES_MIGRATION_COMMAND}`,
    ];
  }

  async run() {
    const self = this.self;

    // The deferral is the firebase.json target's question — answered before we
    // look at the source at all, so nothing here can rewrite it.
    if (deferredRulesTarget({ projectDir: self.firebaseProjectPath, firebaseJSON: self.firebaseJSON })) {
      return 'warn';
    }

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

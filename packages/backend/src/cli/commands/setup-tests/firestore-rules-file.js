const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const {
  BRAND_RULES_FILE,
  COMPILED_RULES_FILE,
  MARKER_MIGRATION_COMMAND,
  RULES_MIGRATION_COMMAND,
  compileFirestoreRules,
  deferredRulesTarget,
  ensureBrandRulesSource,
  isPreFamilyMarkerFile,
  markerMigrationDeferralNotice,
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

  // Which deferral run() hit, so the reported lines match the reason. Two
  // deferrals share this check: the compiled-rules one (#522) and the
  // pre-family marker one (#40).
  getWarning() {
    if (this.deferral === 'pre-family') {
      return markerMigrationDeferralNotice(BRAND_RULES_FILE);
    }

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

    // A pre-family source DEFERS, before the migration question below: nothing
    // in this check speaks those markers, and a plain `false` would send the
    // driver into fix() — which refuses, and scores as a healed check
    // ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
    if (isPreFamilyMarkerFile(contents)) {
      this.deferral = 'pre-family';
      return 'warn';
    }

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

    // Refused, not fixed: the source is pre-family and was left untouched, so
    // there is nothing to compile from it either ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
    if (result.refused) {
      console.log(chalk.red(`${BRAND_RULES_FILE} still carries a pre-family marker ('{{ backend-manager }}' or a '///---...---///' block), which this check does not speak — it was left untouched. Run \`${MARKER_MIGRATION_COMMAND}\` to convert it, then run this again.`));
      return;
    }

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

const chalk = require('chalk').default;
const path = require('path');
const jetpack = require('fs-jetpack');
const BaseCommand = require('./base-command');
const {
  BRAND_RULES_FILE,
  COMPILED_RULES_FILE,
  MARKER_MIGRATION_COMMAND,
  compileFirestoreRules,
  deferredRulesTarget,
  ensureBrandRulesSource,
} = require('../utils/compile-rules');

/**
 * `omega migrate:rules` — the one-time move onto the compiled rules model
 * ([#522](https://github.com/Omega-JS-Stack/omega/issues/522)).
 *
 * A brand whose firebase.json still names its own `firestore.rules` deploys the
 * brand half alone. Adopting the compiled artifact adds the framework half and
 * modernizes the source, which CHANGES what the live project enforces — so it
 * is this verb's job, run alone and deliberately, never something another
 * verb heals on the way to a deploy (the target checks defer instead).
 *
 * Idempotent: a brand already on `dist/firestore.rules` is reported and left
 * alone.
 */
class MigrateRulesCommand extends BaseCommand {
  async execute() {
    const projectDir = this.main.firebaseProjectPath;
    const firebaseJSONPath = path.join(projectDir, 'firebase.json');
    const firebaseJSON = jetpack.read(firebaseJSONPath, 'json');

    this.ui.header('Firestore rules migration', { subtitle: projectDir, subtitleColor: chalk.dim });

    if (!firebaseJSON) {
      this.ui.status('fail', chalk.red(`No firebase.json at ${projectDir} — run this from the target root.`));
      process.exitCode = 1;
      return;
    }

    const deferred = deferredRulesTarget({ projectDir: projectDir, firebaseJSON: firebaseJSON });

    if (!deferred) {
      this.ui.status('skip', `Nothing to migrate — firebase.json already points firestore.rules at ${chalk.bold(firebaseJSON.firestore?.rules || COMPILED_RULES_FILE)}.`);
      return;
    }

    this.ui.status('warn', chalk.yellow(`This CHANGES LIVE POSTURE on your next deploy: ${COMPILED_RULES_FILE} carries the framework half beside your rules, and a legacy \`allow write\` becomes \`allow create, update\` (a client deleting its own doc flips allowed → denied).`));
    this.ui.blank();

    // Half one: the brand's authored source, migrated in place.
    const result = ensureBrandRulesSource({ projectDir: projectDir });

    // A pre-family source is refused untouched, so NEITHER half may run:
    // repointing firebase.json here would deploy a compile of a file still
    // carrying `///---...---///` markers ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
    if (result.refused) {
      this.ui.status('fail', chalk.red(`${BRAND_RULES_FILE} still carries a pre-family marker ('{{ backend-manager }}' or a '///---...---///' block), which this migration does not speak — nothing was changed. Run ${chalk.bold(MARKER_MIGRATION_COMMAND)} first, then run this again.`));
      process.exitCode = 1;
      return;
    }

    if (result.created) {
      this.ui.status('add', `Seeded ${BRAND_RULES_FILE} — your rules, compiled with the framework half. It is yours to edit.`);
    }
    if (result.migrated) {
      this.ui.status('change', `Migrated ${BRAND_RULES_FILE} to rules v3 (merge-by-match) — your own rules were kept, and a match block of yours that names a framework path now MERGES into it instead of sitting beside it.`);
    }
    for (const hook of result.strippedHooks) {
      this.ui.status('change', chalk.yellow(`Removed the retired \`${hook}()\` hook from ${BRAND_RULES_FILE} — it still carried the default body, and nothing calls it any more.`));
    }
    for (const hook of result.keptHooks) {
      this.ui.status('warn', chalk.red(`${BRAND_RULES_FILE}: the retired \`${hook}()\` hook carried YOUR code, so it was kept as an ordinary function — but NOTHING CALLS IT NOW. Move what it enforced into a \`match\` block of your own (it merges into the framework's), then delete it.`));
    }

    // Half two: firebase.json, repointed at the artifact both the emulator and
    // `firebase deploy` read.
    firebaseJSON.firestore = { ...firebaseJSON.firestore, rules: COMPILED_RULES_FILE };
    jetpack.write(firebaseJSONPath, JSON.stringify(firebaseJSON, null, 2));
    this.ui.status('change', `firebase.json now points firestore.rules at ${chalk.bold(COMPILED_RULES_FILE)} (was "${deferred}").`);

    compileFirestoreRules({ projectDir: projectDir });
    this.ui.status('pass', `Compiled ${COMPILED_RULES_FILE}.`);

    this.ui.blank();
    this.ui.status('running', `Next: read the diff (${chalk.bold(`git diff ${BRAND_RULES_FILE} firebase.json`)}), run ${chalk.bold('npx omega test')}, then deploy when the new posture is what you want.`);
  }
}

module.exports = MigrateRulesCommand;

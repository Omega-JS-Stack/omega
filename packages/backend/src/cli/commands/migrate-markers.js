const chalk = require('chalk').default;
const path = require('path');
const jetpack = require('fs-jetpack');
const BaseCommand = require('./base-command');
const { omegaAllRulesRegex } = require('./setup-tests/helpers');
const {
  BRAND_RULES_FILE,
  isPreFamilyMarkerFile,
  migratePreFamilyMarkerFile,
  preFamilyPlaceholderRegex,
} = require('../utils/compile-rules');

// The realtime rules file, at the target root — still marker-managed (only
// firestore.rules moved to the compiled model).
const REALTIME_RULES_FILE = 'database.rules.json';

// The framework's own realtime template, whose family zone a placeholder-only
// file is given wholesale.
const REALTIME_RULES_TEMPLATE = path.resolve(__dirname, '..', '..', '..', 'templates', REALTIME_RULES_FILE);

/**
 * BEM's .gitignore block, byte-exact. Its own fix() deleted the WHOLE match,
 * content included — those lines were framework-owned, and the family's Default
 * zone re-writes them on the next verb. Fresh regex per call (/g carries
 * lastIndex).
 * @returns {RegExp}
 */
function bemGitignoreBlockRegex() {
  return /# BEM>>>([\s\S]*?)# <<<BEM\n?/g;
}

// The legacy version stamp, its own line above the block's content. The family
// folded the version into the open marker's label, so the two collapse into one.
const PRE_FAMILY_VERSION_LINE = /\/\/\/---version=(.*?)---\/\/\//;

/**
 * `omega migrate:markers` — the one-time conversion of PRE-FAMILY marker
 * formats onto the family grammar
 * ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
 *
 * Four shapes predate the family (_attic/plans/archive/marker-harmonization.md):
 * the hand-written `{{ backend-manager }}` placeholder, the `# BEM>>>` gitignore
 * block, the `///---backend-manager---///` rules block, and the cp72-74
 * `///---omega---///` interim flavor. Nothing evergreen matches any of them, so
 * a tree carried over from BEM never converges — the verbs report the shape and
 * point here rather than converting behind the brand's back.
 *
 * Idempotent: a target already speaking the family is reported clean and left
 * byte-untouched.
 */
class MigrateMarkersCommand extends BaseCommand {
  async execute() {
    const projectDir = this.main.firebaseProjectPath;
    const firebaseJSON = jetpack.read(path.join(projectDir, 'firebase.json'), 'json');

    this.ui.header('Pre-family marker migration', { subtitle: projectDir, subtitleColor: chalk.dim });

    if (!firebaseJSON) {
      this.ui.status('fail', chalk.red(`No firebase.json at ${projectDir} — run this from the target root.`));
      process.exitCode = 1;
      return;
    }

    const converted = [
      this.migrateGitignore(projectDir),
      this.migrateFirestoreRules(projectDir),
      this.migrateRealtimeRules(projectDir),
    ].filter(Boolean);

    if (!converted.length) {
      this.ui.status('skip', 'Nothing to migrate — every marker in this target already speaks the family grammar.');
      return;
    }

    this.ui.blank();
    this.ui.status('running', `Next: read the diff (${chalk.bold(`git diff ${converted.join(' ')}`)}), then run ${chalk.bold('npx omega test')} — the target checks converge the core rules and the Default zones from here.`);
  }

  /**
   * Delete every `# BEM>>>` … `# <<<BEM` block, content included. Everything
   * outside is the consumer's and stays byte-untouched: the two-zone merge that
   * re-writes the framework lines is `ensureTarget()`'s, on the next verb.
   * @param {string} projectDir - The target root.
   * @returns {string|null} The file name when it was rewritten.
   */
  migrateGitignore(projectDir) {
    const filePath = path.join(projectDir, '.gitignore');
    const contents = jetpack.read(filePath);

    if (!contents || !bemGitignoreBlockRegex().test(contents)) {
      return null;
    }

    jetpack.write(filePath, contents.replace(bemGitignoreBlockRegex(), ''));
    this.ui.status('change', `Removed the legacy ${chalk.bold('# BEM>>>')} block from ${chalk.bold('.gitignore')} — its lines were framework-owned, and the Default zone carries them now. Everything you wrote is untouched.`);

    return '.gitignore';
  }

  /**
   * Convert a pre-family firestore.rules onto the compiled model's source: the
   * managed block (or the bare placeholder) goes, the brand's own rules land in
   * the current seed.
   * @param {string} projectDir - The target root.
   * @returns {string|null} The file name when it was rewritten.
   */
  migrateFirestoreRules(projectDir) {
    const filePath = path.join(projectDir, BRAND_RULES_FILE);
    const contents = jetpack.read(filePath);

    if (!contents || !isPreFamilyMarkerFile(contents)) {
      return null;
    }

    jetpack.write(filePath, migratePreFamilyMarkerFile(contents));
    this.ui.status('change', `Migrated ${chalk.bold(BRAND_RULES_FILE)} onto the compiled-rules source shape — your own rules were kept, and the framework's managed block is gone (it ships inside @omega.js/backend and compiles in).`);

    return BRAND_RULES_FILE;
  }

  /**
   * Convert a pre-family database.rules.json. It is still marker-MANAGED, so
   * the markers are re-cut rather than removed:
   *   - open + version line → one family open line carrying that version
   *   - tests/resources dividers → dropped (the family has no twin for them)
   *   - end marker → the family close
   * A placeholder-only file has no block to re-cut, so it is given the current
   * template's whole managed block at v0.0.0 — which the setup checks then
   * converge to the live rules version.
   * @param {string} projectDir - The target root.
   * @returns {string|null} The file name when it was rewritten.
   */
  migrateRealtimeRules(projectDir) {
    const filePath = path.join(projectDir, REALTIME_RULES_FILE);
    const contents = jetpack.read(filePath);

    if (!contents || !isPreFamilyMarkerFile(contents)) {
      return null;
    }

    const stamp = versionStamp(contents);

    jetpack.write(filePath, contents
      .replace(/^([^\S\n]*)\/\/\/---(?:backend-manager|omega)---\/\/\/[^\S\n]*\n(?:[^\S\n]*\/\/\/---version=.*?---\/\/\/[^\S\n]*\n)?/m, `$1// ========== OMEGA Rules (v${stamp}) ==========\n`)
      .replace(/^[^\S\n]*\/\/\/-+(?:tests|resources)-+\/\/\/[^\S\n]*\n/gm, '')
      .replace(/^([^\S\n]*)\/\/\/---------end---------\/\/\/[^\S\n]*$/m, '$1// ========== End OMEGA Rules ==========')
      .replace(preFamilyPlaceholderRegex(), () => managedRealtimeBlock()));
    this.ui.status('change', `Re-cut the managed block in ${chalk.bold(REALTIME_RULES_FILE)} to the family grammar (${chalk.bold(`// ========== OMEGA Rules (v${stamp}) ==========`)}) — the rules inside it are unchanged.`);

    return REALTIME_RULES_FILE;
  }
}

/**
 * The version the legacy stamp declared, for the family open marker's label.
 * Unparseable (or absent, which is the placeholder flavor) reads as 0.0.0, and
 * the setup checks converge it to the live rules version on the next run.
 * @param {string} contents - The pre-family file.
 * @returns {string} An `X.Y.Z` version.
 */
function versionStamp(contents) {
  const declared = PRE_FAMILY_VERSION_LINE.exec(contents)?.[1] || '';

  return /^\d+\.\d+\.\d+$/.test(declared) ? declared : '0.0.0';
}

/**
 * The framework template's whole managed block — markers included, at the
 * template's own v0.0.0 stamp.
 * @returns {string}
 */
function managedRealtimeBlock() {
  return jetpack.read(REALTIME_RULES_TEMPLATE).match(omegaAllRulesRegex)[0];
}

module.exports = MigrateMarkersCommand;

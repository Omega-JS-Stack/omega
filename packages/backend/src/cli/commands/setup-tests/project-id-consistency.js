const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');
const chalk = require('chalk').default;
const helpers = require('./helpers');
const { hasOmegaConfig, loadConfig } = require('@omegajs/config');

/**
 * Ensures projectId is consistent across all configuration files:
 * - .firebaserc (projects.default)
 * - functions/config/omega.json5 (firebaseConfig.projectId — resolved, so a
 *   brand-level firebaseConfig in a brand monorepo counts)
 * - functions/service-account.json (project_id)
 *
 * Mismatches cause tests to fail when running emulator in separate terminals
 * because different parts of the system connect to different Firestore databases.
 */
class ProjectIdConsistencyTest extends BaseTest {
  getName() {
    return 'project IDs are consistent across all config files';
  }

  async run() {
    const sources = this.getProjectIdSources();

    // Check if we have at least .firebaserc (the source of truth)
    if (!sources.firebaserc.exists) {
      console.error(chalk.red('Missing .firebaserc file'));
      return false;
    }

    if (!sources.firebaserc.projectId) {
      console.error(chalk.red('Missing projects.default in .firebaserc'));
      return false;
    }

    const expectedProjectId = sources.firebaserc.projectId;
    const mismatches = [];

    // Check config/omega.json5
    if (sources.bemConfig.exists) {
      if (!sources.bemConfig.projectId) {
        mismatches.push({
          file: 'config/omega.json5',
          field: 'firebaseConfig.projectId',
          expected: expectedProjectId,
          actual: '(missing)',
        });
      } else if (sources.bemConfig.projectId !== expectedProjectId) {
        mismatches.push({
          file: 'config/omega.json5',
          field: 'firebaseConfig.projectId',
          expected: expectedProjectId,
          actual: sources.bemConfig.projectId,
        });
      }
    }

    // Check service-account.json
    if (sources.serviceAccount.exists) {
      if (!sources.serviceAccount.projectId) {
        mismatches.push({
          file: 'service-account.json',
          field: 'project_id',
          expected: expectedProjectId,
          actual: '(missing)',
        });
      } else if (sources.serviceAccount.projectId !== expectedProjectId) {
        mismatches.push({
          file: 'service-account.json',
          field: 'project_id',
          expected: expectedProjectId,
          actual: sources.serviceAccount.projectId,
        });
      }
    }

    if (mismatches.length > 0) {
      console.error(chalk.red('\nProject ID mismatches detected:'));
      console.error(chalk.gray(`  Source of truth: .firebaserc → ${expectedProjectId}\n`));

      for (const mismatch of mismatches) {
        console.error(chalk.red(`  ${mismatch.file} (${mismatch.field})`));
        console.error(chalk.gray(`    Expected: ${mismatch.expected}`));
        console.error(chalk.gray(`    Actual:   ${mismatch.actual}\n`));
      }

      return false;
    }

    return true;
  }

  getProjectIdSources() {
    const projectPath = this.self.firebaseProjectPath;

    // .firebaserc
    const firebasercPath = `${projectPath}/.firebaserc`;
    const firebasercContent = jetpack.read(firebasercPath);
    const firebasercData = firebasercContent ? JSON5.parse(firebasercContent) : null;

    // config/omega.json5 — resolved through the loader so the projectId is
    // found wherever the hierarchy puts it (app file or brand file)
    let omegaProjectId = null;
    const omegaExists = hasOmegaConfig(projectPath);
    if (omegaExists) {
      try {
        omegaProjectId = loadConfig(projectPath, 'backend').config.firebaseConfig?.projectId || null;
      } catch (e) {
        // Unloadable config — the omega-config test reports it; treat as missing here
      }
    }

    // service-account.json
    const serviceAccountPath = `${projectPath}/functions/service-account.json`;
    const serviceAccountContent = jetpack.read(serviceAccountPath);
    const serviceAccountData = serviceAccountContent ? JSON5.parse(serviceAccountContent) : null;

    return {
      firebaserc: {
        exists: !!firebasercContent,
        projectId: firebasercData?.projects?.default || null,
      },
      bemConfig: {
        exists: omegaExists,
        projectId: omegaProjectId,
      },
      serviceAccount: {
        exists: !!serviceAccountContent,
        projectId: serviceAccountData?.project_id || null,
      },
    };
  }

  async fix() {
    const sources = this.getProjectIdSources();

    if (!sources.firebaserc.projectId) {
      console.log(chalk.red('Cannot fix: .firebaserc is missing or has no projects.default'));
      console.log(chalk.yellow('Run: firebase use --add'));
      throw new Error('Missing .firebaserc configuration');
    }

    const expectedProjectId = sources.firebaserc.projectId;

    // Fix config/omega.json5 — write the APP file (raw): an app-level
    // firebaseConfig.projectId is the top override layer, so it wins even
    // when the wrong value came from a brand-level file
    if (sources.bemConfig.exists && sources.bemConfig.projectId !== expectedProjectId) {
      const omegaConfigPath = `${this.self.firebaseProjectPath}/functions/config/omega.json5`;
      const omegaConfigData = JSON5.parse(jetpack.read(omegaConfigPath) || '{}');

      omegaConfigData.firebaseConfig = omegaConfigData.firebaseConfig || {};
      omegaConfigData.firebaseConfig.projectId = expectedProjectId;

      helpers.saveJSON5(omegaConfigPath, omegaConfigData);
      console.log(chalk.green(`Fixed: config/omega.json5 → firebaseConfig.projectId = ${expectedProjectId}`));
    }

    // Cannot auto-fix service-account.json - must download correct one from Firebase Console
    if (sources.serviceAccount.exists && sources.serviceAccount.projectId !== expectedProjectId) {
      console.log(chalk.red(`\nCannot auto-fix service-account.json`));
      console.log(chalk.yellow(`  Current project_id: ${sources.serviceAccount.projectId}`));
      console.log(chalk.yellow(`  Expected project_id: ${expectedProjectId}`));
      console.log(chalk.yellow(`\n  Download the correct service account from:`));
      console.log(chalk.cyan(`  https://console.firebase.google.com/project/${expectedProjectId}/settings/serviceaccounts/adminsdk`));
      throw new Error('service-account.json has wrong project_id - download correct one from Firebase Console');
    }
  }
}

module.exports = ProjectIdConsistencyTest;
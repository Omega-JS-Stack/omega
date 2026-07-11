const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');
const chalk = require('chalk').default;
const { hasOmegaConfig, loadConfig, writeConfigValues } = require('@omega.js/config');
const { buildDemoServiceAccount } = require('./service-account');

/**
 * Ensures projectId is consistent across all configuration files:
 * - functions/config/omega.json5 (cloud.config.projectId — resolved, so a
 *   brand-level cloud.config in a brand monorepo counts) — THE SOURCE OF
 *   TRUTH: config carries user choices, everything else is derived
 * - .firebaserc (projects.default) — derived artifact, rewritten from config
 * - functions/service-account.json (project_id) — derived for demo-*
 *   (regenerated fake), downloaded for real projects
 *
 * Mismatches cause tests to fail when running emulator in separate terminals
 * because different parts of the system connect to different Firestore
 * databases. Direction matters (dogfood friction #11): the old fixer wrote a
 * STALE .firebaserc value INTO the config (comment-stripping rewrite included)
 * — precedence is config → derived artifacts, never the reverse.
 */
class ProjectIdConsistencyTest extends BaseTest {
  getName() {
    return 'project IDs are consistent across all config files';
  }

  async run() {
    const sources = this.getProjectIdSources();
    const expectedProjectId = sources.bemConfig.projectId || sources.firebaserc.projectId;

    if (!expectedProjectId) {
      console.error(chalk.red('No project id anywhere: set cloud.config.projectId in config/omega.json5 (demo-<id> for emulator-only)'));
      return false;
    }

    const mismatches = [];

    if (!sources.firebaserc.exists || !sources.firebaserc.projectId) {
      mismatches.push({
        file: '.firebaserc',
        field: 'projects.default',
        expected: expectedProjectId,
        actual: '(missing)',
      });
    } else if (sources.firebaserc.projectId !== expectedProjectId) {
      mismatches.push({
        file: '.firebaserc',
        field: 'projects.default',
        expected: expectedProjectId,
        actual: sources.firebaserc.projectId,
      });
    }

    // Config missing the id while .firebaserc has one — the config should own it
    if (sources.bemConfig.exists && !sources.bemConfig.projectId) {
      mismatches.push({
        file: 'config/omega.json5',
        field: 'cloud.config.projectId',
        expected: expectedProjectId,
        actual: '(missing)',
      });
    }

    // Check service-account.json
    if (sources.serviceAccount.exists) {
      if (sources.serviceAccount.projectId !== expectedProjectId) {
        mismatches.push({
          file: 'service-account.json',
          field: 'project_id',
          expected: expectedProjectId,
          actual: sources.serviceAccount.projectId || '(missing)',
        });
      }
    }

    if (mismatches.length > 0) {
      console.error(chalk.red('\nProject ID mismatches detected:'));
      console.error(chalk.gray(`  Source of truth: config cloud.config.projectId → ${expectedProjectId}\n`));

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
        omegaProjectId = loadConfig(projectPath, 'backend').config.cloud?.config?.projectId || null;
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
    const projectPath = this.self.firebaseProjectPath;
    const sources = this.getProjectIdSources();
    const expectedProjectId = sources.bemConfig.projectId || sources.firebaserc.projectId;

    if (!expectedProjectId) {
      console.log(chalk.red('Cannot fix: no project id in config/omega.json5 or .firebaserc'));
      console.log(chalk.yellow('Set cloud.config.projectId in config/omega.json5 (demo-<id> for emulator-only)'));
      throw new Error('No project id configured');
    }

    // Config lacks the id (only .firebaserc had one) — land it in config via
    // the comment-preserving editor, so the config owns it from here on.
    // (writeConfigValues edits the file resolveConfigPath finds for this app;
    // wizard-seeded brands already carry it at the brand root and never hit this.)
    if (sources.bemConfig.exists && !sources.bemConfig.projectId) {
      writeConfigValues(projectPath, { 'cloud.config.projectId': expectedProjectId });
      console.log(chalk.green(`Fixed: config/omega.json5 → cloud.config.projectId = ${expectedProjectId}`));
    }

    // .firebaserc is DERIVED — rewrite it from config
    if (sources.firebaserc.projectId !== expectedProjectId) {
      const firebasercPath = `${projectPath}/.firebaserc`;
      const firebasercData = sources.firebaserc.exists ? JSON5.parse(jetpack.read(firebasercPath)) : {};
      firebasercData.projects = firebasercData.projects || {};
      firebasercData.projects.default = expectedProjectId;
      jetpack.write(firebasercPath, `${JSON.stringify(firebasercData, null, 2)}\n`);
      console.log(chalk.green(`Fixed: .firebaserc → projects.default = ${expectedProjectId}`));
    }

    // service-account.json: demo-* fakes regenerate; real ones must be downloaded
    if (sources.serviceAccount.exists && sources.serviceAccount.projectId !== expectedProjectId) {
      if (this.isDemoProject) {
        const saPath = `${projectPath}/functions/service-account.json`;
        jetpack.write(saPath, `${JSON.stringify(buildDemoServiceAccount(expectedProjectId), null, 2)}\n`);
        console.log(chalk.green(`Fixed: regenerated fake service-account.json for ${expectedProjectId}`));
      } else {
        console.log(chalk.red(`\nCannot auto-fix service-account.json`));
        console.log(chalk.yellow(`  Current project_id: ${sources.serviceAccount.projectId}`));
        console.log(chalk.yellow(`  Expected project_id: ${expectedProjectId}`));
        console.log(chalk.yellow(`\n  Download the correct service account from:`));
        console.log(chalk.cyan(`  https://console.firebase.google.com/project/${expectedProjectId}/settings/serviceaccounts/adminsdk`));
        throw new Error('service-account.json has wrong project_id - download correct one from Firebase Console');
      }
    }
  }
}

module.exports = ProjectIdConsistencyTest;

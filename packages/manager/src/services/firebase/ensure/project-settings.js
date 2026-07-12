/**
 * Ensure project identity: the GCP display name matches the brand and a web
 * app named 'Web App' exists.
 *
 * omega-manager PATCHed the project name on every run; this diffs first —
 * a converged project is a zero-mutation no-op.
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

const WEB_APP_NAME = 'Web App';

module.exports = async function ensureProjectSettings(context) {
  const { firebaseApi: api, brandConfig, projectId, options = {} } = context;
  const brandName = brandConfig.brand?.name;

  const updates = {};

  // === Project display name ===
  const gcpProject = await api.getGcpProject(projectId);

  if (gcpProject?.displayName === brandName) {
    console.log(`      ${chalk.green('✓')} Project name: ${chalk.cyan(brandName)}`);
    updates.projectName = brandName;
  } else if (options.dryRun) {
    dryRunPlan(`rename project ${gcpProject?.displayName || '(unknown)'} → ${brandName}`);
  } else {
    try {
      await api.updateProjectName(projectId, brandName);
      console.log(`      ${chalk.green('✓')} Project name set to ${chalk.cyan(brandName)}`);
      updates.projectName = brandName;
    } catch (error) {
      console.log(`      ${chalk.yellow('⚠')} Could not update project name${chalk.dim(`: ${error.message}`)}`);
    }
  }

  // === Web app ===
  try {
    const apps = await api.listWebApps(projectId);

    if (apps.length === 0) {
      if (options.dryRun) {
        dryRunPlan(`create web app "${WEB_APP_NAME}"`);
      } else {
        console.log('      Creating web app...');
        await api.createWebApp(projectId, WEB_APP_NAME);
        console.log(`      ${chalk.green('✓')} Created web app: ${chalk.cyan(WEB_APP_NAME)}`);
        updates.webAppName = WEB_APP_NAME;
      }
    } else if (apps[0].displayName !== WEB_APP_NAME) {
      if (options.dryRun) {
        dryRunPlan(`rename web app ${apps[0].displayName} → ${WEB_APP_NAME}`);
      } else {
        try {
          await api.updateWebAppDisplayName(projectId, apps[0].appId, WEB_APP_NAME);
          console.log(`      ${chalk.green('✓')} Renamed web app: ${chalk.cyan(apps[0].displayName)} → ${chalk.cyan(WEB_APP_NAME)}`);
          updates.webAppName = WEB_APP_NAME;
        } catch (error) {
          console.log(`      ${chalk.yellow('⚠')} Could not rename web app${chalk.dim(`: ${error.message}`)}`);
          updates.webAppName = apps[0].displayName;
        }
      }
    } else {
      console.log(`      ${chalk.green('✓')} Web app: ${chalk.cyan(WEB_APP_NAME)}`);
      updates.webAppName = WEB_APP_NAME;
    }
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Could not configure web app${chalk.dim(`: ${error.message}`)}`);
  }

  return { state: { settings: updates } };
};

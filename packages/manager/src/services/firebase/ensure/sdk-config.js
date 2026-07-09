/**
 * Ensure the web SDK config is fetched into state — and that the brand's
 * omega.json5 `firebaseConfig` section matches it.
 *
 * authDomain is replaced with the brand's own domain (custom auth domain).
 * The fetched config is durable state; drift against omega.json5 is written
 * back into the file key-by-key (comment-preserving), so per-key comments
 * survive. Dry-run prints the paste-able block instead and warns.
 */
const chalk = require('chalk').default;
const { writeBrandConfig } = require('../../../lib/config-write.js');

// The canonical firebaseConfig keys frameworks read from omega.json5
const SDK_KEYS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];

module.exports = async function ensureSdkConfig(context) {
  const { firebaseApi: api, brandConfig, projectId, domain, options = {} } = context;

  // === READ (web app must exist; project-settings creates it too) ===
  const apps = await api.listWebApps(projectId);
  let appId = apps[0]?.appId;

  if (!appId) {
    if (options.dryRun) {
      console.log(`      ${chalk.dim('⊘ Dry run — would create a web app and fetch its SDK config')}`);
      return { output: { sdkConfig: { planned: 'create-web-app' } } };
    }

    console.log('      Creating web app...');
    appId = await api.createWebApp(projectId, 'Web App');

    if (!appId) {
      console.log(`      ${chalk.yellow('⚠')} Could not get or create a web app`);
      return { status: 'warned', output: { sdkConfig: { error: 'no web app' } } };
    }
  }

  const raw = await api.getWebAppConfig(projectId, appId);

  const sdkConfig = {
    apiKey: raw.apiKey,
    authDomain: domain, // custom auth domain — the brand's own, not {projectId}.firebaseapp.com
    databaseURL: raw.databaseURL || `https://${projectId}-default-rtdb.firebaseio.com`,
    projectId: raw.projectId,
    storageBucket: raw.storageBucket,
    messagingSenderId: raw.messagingSenderId,
    appId: raw.appId,
    measurementId: raw.measurementId || '',
  };

  console.log(`      ${chalk.green('✓')} Got SDK config ${chalk.dim(`(apiKey: ${sdkConfig.apiKey.substring(0, 10)}...)`)}`);

  // === Drift check: omega.json5's firebaseConfig is what the apps run on ===
  const configured = brandConfig.firebaseConfig || {};
  const drifted = SDK_KEYS.filter((key) => (configured[key] || '') !== (sdkConfig[key] || ''));

  if (drifted.length === 0) {
    console.log(`      ${chalk.green('✓')} omega.json5 firebaseConfig matches`);
    return { state: { sdkConfig } };
  }

  console.log(`      ${chalk.yellow('↻')} omega.json5 firebaseConfig ${Object.keys(configured).length === 0 ? 'is missing' : `drifts (${drifted.join(', ')})`}`);

  const edits = {};
  for (const key of drifted) {
    edits[`firebaseConfig.${key}`] = sdkConfig[key];
  }
  writeBrandConfig(context, edits);

  if (options.dryRun) {
    // The file wasn't touched — hand over the paste block
    console.log(`      ${chalk.dim('→')} Set this in config/omega.json5:`);
    console.log(chalk.cyan(`      firebaseConfig: ${JSON.stringify(sdkConfig, null, 2).replace(/\n/g, '\n      ')},`));
    return {
      status: 'warned',
      state: { sdkConfig },
      output: { sdkConfig: { drifted } },
    };
  }

  return {
    state: { sdkConfig },
    output: { sdkConfig: { updated: drifted } },
  };
};

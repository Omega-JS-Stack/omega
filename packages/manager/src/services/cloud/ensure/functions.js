/**
 * Verify Cloud Functions prerequisites are ready (the services operation
 * enables them; this is a read-only readiness check).
 */
const chalk = require('chalk').default;

const REQUIRED_SERVICES = [
  'cloudfunctions.googleapis.com',
  'cloudbuild.googleapis.com',
  'run.googleapis.com',
];

module.exports = async function ensureFunctions(context) {
  const { firebaseApi: api, projectId } = context;

  let allEnabled = true;
  const status = {};

  for (const service of REQUIRED_SERVICES) {
    try {
      const enabled = await api.isServiceEnabled(projectId, service);
      status[service.replace('.googleapis.com', '')] = enabled;

      if (!enabled) {
        allEnabled = false;
      }
    } catch {
      allEnabled = false;
    }
  }

  if (allEnabled) {
    console.log(`      ${chalk.green('✓')} Cloud Functions ready`);
  } else {
    console.log(`      ${chalk.yellow('⚠')} Some Cloud Functions APIs not enabled`);
    console.log(`      ${chalk.dim('→')} The services operation enables them — rerun`);
  }

  return {
    status: allEnabled ? 'success' : 'warned',
    ...(allEnabled ? {} : { reason: 'some Cloud Functions APIs are not enabled' }),
    state: {
      functions: {
        ready: allEnabled,
        services: status,
      },
    },
  };
};

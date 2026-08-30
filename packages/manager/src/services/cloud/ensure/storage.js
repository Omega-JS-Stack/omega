/**
 * Ensure the Firebase Storage default bucket exists and is linked
 * (new buckets: {projectId}.firebasestorage.app; pre-Oct-2024:
 * {projectId}.appspot.com).
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensureStorage(context) {
  const { firebaseApi: api, projectId, options = {} } = context;

  // === READ ===
  const existing = await api.getStorageBucket(projectId);

  if (existing) {
    console.log(`      ${chalk.green('✓')} Storage bucket exists: ${chalk.cyan(existing.name)}`);
    return { state: { storage: { bucket: existing.name } } };
  }

  // === WRITE ===
  if (options.dryRun) {
    return dryRunPlan('create the default storage bucket', { output: { storage: { planned: 'create' } } });
  }

  console.log('      Creating storage bucket...');
  try {
    const result = await api.createDefaultStorageBucket(projectId);

    if (result.alreadyLinked) {
      console.log(`      ${chalk.green('✓')} Storage bucket exists: ${chalk.cyan(result.bucket)}`);
    } else {
      console.log(`      ${chalk.green('✓')} Storage bucket created: ${chalk.cyan(result.bucket)}`);
    }

    return { state: { storage: { bucket: result.bucket } } };
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Could not create storage bucket${chalk.dim(`: ${error.message}`)}`);

    if (error.message?.includes('BILLING')) {
      console.log(`      ${chalk.dim('→')} Project must be on the Blaze plan to create storage buckets`);
    } else {
      console.log(`      ${chalk.dim('→')} Create manually: ${chalk.cyan(`https://console.firebase.google.com/project/${projectId}/storage`)}`);
    }

    return { status: 'warned', reason: 'could not create the storage bucket', output: { storage: { error: error.message } } };
  }
};

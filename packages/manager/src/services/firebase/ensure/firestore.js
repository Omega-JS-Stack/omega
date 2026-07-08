/**
 * Ensure the Firestore database exists (nam5 US multi-region) with
 * Point-in-Time Recovery enabled (7-day disaster recovery).
 */
const chalk = require('chalk').default;

module.exports = async function ensureFirestore(context) {
  const { firebaseApi: api, projectId, options = {} } = context;

  // === READ ===
  const existing = await api.getFirestoreDatabase(projectId);

  if (existing) {
    console.log(`      ${chalk.green('✓')} Firestore database exists`);
    await ensurePITR(api, projectId, existing, options);

    return {
      state: {
        firestore: {
          databaseId: '(default)',
          locationId: existing.locationId,
          pitrEnabled: true,
        },
      },
    };
  }

  // === WRITE ===
  if (options.dryRun) {
    console.log(`      ${chalk.dim('⊘ Dry run — would create Firestore database (nam5) + enable PITR')}`);
    return { output: { firestore: { planned: 'create' } } };
  }

  console.log('      Creating Firestore database...');
  try {
    const result = await api.createFirestoreDatabase(projectId, 'nam5');
    console.log(`      ${chalk.green('✓')} Created Firestore database`);

    await ensurePITR(api, projectId, result, options);

    return {
      state: {
        firestore: {
          databaseId: '(default)',
          locationId: result?.locationId || 'nam5',
          pitrEnabled: true,
        },
      },
    };
  } catch (error) {
    if (error.message?.includes('already exists')) {
      console.log(`      ${chalk.green('✓')} Firestore database exists`);
      await ensurePITR(api, projectId, null, options);
      return { state: { firestore: { databaseId: '(default)', pitrEnabled: true } } };
    }

    console.log(`      ${chalk.yellow('⚠')} Could not create Firestore${chalk.dim(`: ${error.message}`)}`);
    return { status: 'warned', output: { firestore: { error: error.message } } };
  }
};

async function ensurePITR(api, projectId, database, options) {
  if (database?.pointInTimeRecoveryEnablement === 'POINT_IN_TIME_RECOVERY_ENABLED') {
    console.log(`      ${chalk.green('✓')} PITR enabled (7-day recovery)`);
    return;
  }

  if (options.dryRun) {
    console.log(`      ${chalk.dim('⊘ Dry run — would enable PITR')}`);
    return;
  }

  console.log('      Enabling PITR (Point-in-Time Recovery)...');
  try {
    await api.enableFirestorePITR(projectId);
    console.log(`      ${chalk.green('✓')} PITR enabled (7-day recovery)`);
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Could not enable PITR${chalk.dim(`: ${error.message}`)}`);
  }
}

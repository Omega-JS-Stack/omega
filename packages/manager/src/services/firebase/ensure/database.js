/**
 * Ensure the Realtime Database default instance exists
 * ({projectId}-default-rtdb in us-central1).
 */
const chalk = require('chalk').default;

module.exports = async function ensureDatabase(context) {
  const { firebaseApi: api, projectId, options = {} } = context;

  // === READ ===
  const existing = await api.listRealtimeDatabases(projectId);

  if (existing.length > 0) {
    const db = existing[0];
    console.log(`      ${chalk.green('✓')} Realtime Database exists`);
    return {
      state: {
        database: {
          databaseURL: db.databaseUrl,
          name: db.name,
        },
      },
    };
  }

  // === WRITE ===
  if (options.dryRun) {
    console.log(`      ${chalk.dim('⊘ Dry run — would create the Realtime Database')}`);
    return { output: { database: { planned: 'create' } } };
  }

  console.log('      Creating Realtime Database...');
  try {
    const result = await api.createRealtimeDatabase(projectId, 'us-central1');
    console.log(`      ${chalk.green('✓')} Created Realtime Database`);

    return {
      state: {
        database: {
          databaseURL: result.databaseUrl || `https://${projectId}-default-rtdb.firebaseio.com`,
          name: result.name,
        },
      },
    };
  } catch (error) {
    if (error.message?.includes('already exists')) {
      console.log(`      ${chalk.green('✓')} Realtime Database exists`);
      return {
        state: {
          database: {
            databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
          },
        },
      };
    }

    console.log(`      ${chalk.yellow('⚠')} Could not create database${chalk.dim(`: ${error.message}`)}`);
    return { status: 'warned', output: { database: { error: error.message } } };
  }
};

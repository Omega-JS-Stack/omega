/**
 * Migrations service — runs data migrations on the brand's Firestore
 * collections. Only runs when the --migration flag is set (bare = all
 * migrations, --migration=<name> = just that one), so a normal manage run
 * never touches collection data.
 *
 * The framework (runner, validator, snapshots) plus the two canonical
 * @omegajs/backend-schema migrations (notifications, users) are ported from
 * omega-manager; its other 25 registered migrations are company-instance
 * one-offs (per-app data repairs) and stay there. firebase-admin is
 * replaced by the shared Identity Toolkit + FirestoreREST clients over the
 * brand's own service account.
 *
 * Add new migrations by creating handlers in ensure/ and registering them
 * in config.js OPERATIONS.migrations.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { createServiceRunner } = require('../../lib/service-runner.js');
const { FirestoreREST, loadServiceAccount } = require('../../lib/firestore-rest.js');
const { createAuthAdmin } = require('../../lib/auth-admin.js');

const SERVICE_ACCOUNT_PATH = join('.omega', 'secrets', 'service-account.json');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const { options, operations } = context;

    if (!options?.migration) {
      return { skip: true, reason: '--migration flag not set' };
    }

    const targets = context.brandConfig.targets || {};
    if (!targets.backend) {
      return { skip: true, reason: 'no backend target' };
    }

    // Skip for shared Firebase projects — migrations iterate whole collections,
    // so the owning brand's run covers the project; per-shared-brand runs would
    // just repeat the same migration against the same Firestore
    if (context.brandConfig.firebase?.shared === true) {
      return { skip: true, reason: 'shared Firebase project (owning brand runs migrations)' };
    }

    // Filter to a specific migration if a name was provided (--migration=users)
    const migrationName = typeof options.migration === 'string' ? options.migration : null;
    const filteredOperations = migrationName
      ? operations.filter((op) => op.name === migrationName)
      : operations;

    if (migrationName && filteredOperations.length === 0) {
      console.log(`    ${chalk.yellow('⚠')} ${chalk.yellow(`Migration "${chalk.cyan(migrationName)}" not found. Available: ${chalk.cyan(operations.map((op) => op.name).join(', '))}`)}`);

      return { skip: true, reason: `migration "${migrationName}" not found` };
    }

    // Log skipped migrations
    if (migrationName) {
      for (const op of operations.filter((o) => o.name !== migrationName)) {
        console.log(`    ${chalk.dim(`⊘ ${op.name}: skipped (--migration=${migrationName})`)}`);
      }
    }

    // Tests inject fakes via context
    let authAdmin = context.authAdmin;
    let firestore = context.firestore;
    if (!authAdmin) {
      if (!jetpack.exists(join(context.brandRoot, SERVICE_ACCOUNT_PATH))) {
        return { skip: true, reason: `no service account at ${SERVICE_ACCOUNT_PATH} (run the firebase service first)` };
      }

      const serviceAccount = loadServiceAccount(SERVICE_ACCOUNT_PATH, context.brandRoot);
      authAdmin = createAuthAdmin(serviceAccount);
      firestore = new FirestoreREST(serviceAccount);
    }

    return { operations: filteredOperations, authAdmin, firestore };
  },
});

/**
 * `omega deploy` — the explicit publish verb (D13: commits never
 * auto-publish). Syncs the working tree (commit + push — push triggers
 * NOTHING), then dispatches the scaffolded publish workflow: CI builds,
 * uploads to the stores when credentials are present, and attaches the
 * package zip to a GitHub release (the durable artifact channel).
 *
 * Flags: --dry-run (print the exact dispatch, send nothing; skips sync),
 * --no-sync (dispatch without committing/pushing first).
 */
const { execSync } = require('node:child_process');
const Manager = new (require('../build.js'));
const logger = Manager.logger('deploy');
const { deployViaDispatch, findLocalSpecs, syncWorkingTree } = require('@omega.js/devkit/deploy');

const WORKFLOW = 'publish.yml';

module.exports = async function (options) {
  options = options || {};
  const dryRun = options.dryRun || options['dry-run'];

  // Linked local packages (tree-wide file: specs — cp194) → the LOCAL lane
  // automatically: build + store-publish from this machine with the linked
  // frameworks bundled in. Mirrored rule (Ian 2026-07-20); CI dispatch is
  // only for registry-clean trees.
  if (findLocalSpecs({ dir: process.cwd() }).length > 0) {
    logger.log('Linked local packages detected — building + publishing LOCALLY (linked frameworks bundled; store credentials must be available in this shell). CI dispatch resumes after `omega i live`.');
    if (dryRun) {
      logger.log('DRY RUN — would run: npm run release (local build + store publish)');
      return;
    }
    execSync('npm run release', { stdio: 'inherit' });
    require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'extension', detail: { method: 'local' } });
    return logger.log('Deployed from the LOCAL build (linked frameworks included).');
  }

  if (!dryRun && options.sync !== false) {
    logger.log('Syncing (commit + push — publishes nothing by itself)...');
    syncWorkingTree({ message: 'Deploy', logger });
  }

  const { plan, dispatched } = await deployViaDispatch({ workflow: WORKFLOW, dryRun });

  if (dispatched) {
    require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'extension', detail: { method: 'dispatch' } });
    logger.log(`Dispatched ${WORKFLOW} — CI builds, publishes to stores, and attaches the zip to a GitHub release.`);
    logger.log(`Watch: ${plan.runsUrl}`);
  } else {
    logger.log('DRY RUN — would send:');
    logger.log(`  ${plan.method} ${plan.url}`);
    logger.log(`  body: ${JSON.stringify(plan.body)}`);
    logger.log(`  then watch: ${plan.runsUrl}`);
  }
};

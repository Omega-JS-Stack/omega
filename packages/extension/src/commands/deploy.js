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
const Manager = new (require('../build.js'));
const logger = Manager.logger('deploy');
const { deployViaDispatch, assertNoLocalSpecs, syncWorkingTree } = require('@omega.js/devkit/deploy');

const WORKFLOW = 'publish.yml';

module.exports = async function (options) {
  options = options || {};
  const dryRun = options.dryRun || options['dry-run'];

  // Tree-wide file:-spec guard (same contract as web's deploy): CI rebuilds
  // from pushed source, and npm resolves the whole brand tree — a linked
  // app anywhere in it breaks the CI install.
  if (!dryRun) {
    assertNoLocalSpecs({ dir: process.cwd() });
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

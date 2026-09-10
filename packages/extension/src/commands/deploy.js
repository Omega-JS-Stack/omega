/**
 * `omega deploy` — the explicit publish verb (D13: commits never
 * auto-publish). Syncs the working tree (commit + push — push triggers
 * NOTHING), then dispatches the scaffolded publish workflow: CI builds,
 * uploads to the stores when credentials are present, and attaches the
 * package zip to a GitHub release (the durable artifact channel).
 *
 * Every run starts with the local scaffold the retired `omega setup` used to
 * own (ensureTarget, #675) and then runs setup's NETWORK half as a precheck
 * before the dispatch. `--no-secrets` skips that precheck.
 *
 * Flags: --dry-run (print the exact dispatch, send nothing; skips sync),
 * --no-sync (dispatch without committing/pushing first).
 */
const { execSync } = require('node:child_process');
const Manager = new (require('../build.js'));
const logger = Manager.logger('deploy');
const { deployViaDispatch, dispatchRepo, findLocalSpecs, syncWorkingTree } = require('@omega.js/devkit/deploy');
const { composedWorkflowName } = require('@omega.js/devkit/ci-workflows');
const { resolveSeedMode } = require('@omega.js/config');
const { ensureTarget } = require('./lib/ensure-target.js');
const { deployPrecheck } = require('./lib/deploy-precheck.js');

module.exports = async function (options) {
  options = options || {};
  const dryRun = options.dryRun || options['dry-run'];
  const projectDir = process.cwd();

  // The local half of the retired `omega setup` (#675) — idempotent, offline,
  // and quiet on a converged target.
  await ensureTarget({ projectDir, log: (line) => logger.log(line), warn: (line) => logger.warn(line) });

  // The NETWORK half, as a precheck: a deploy is the verb that needs the
  // remote side right. A dry run sends nothing, so it prechecks nothing.
  if (!dryRun) {
    await deployPrecheck({ projectDir, options, logger });
  }

  // Inside a brand monorepo the target's CI lives in the BRAND ROOT's workflows
  // dir under a per-target name (#265) — dispatch what setup actually composed.
  const WORKFLOW = composedWorkflowName({
    targetDir: process.cwd(),
    brandRoot: resolveSeedMode(process.cwd()).brandRoot,
    workflow: 'publish.yml',
  });

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

  const { owner, repo } = dispatchAddress();
  const { plan, dispatched } = await deployViaDispatch({ workflow: WORKFLOW, owner, repo, dryRun });

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

/**
 * The repo this target's CI dispatch addresses: the brand's own, from its
 * config ([#799](https://github.com/Omega-JS-Stack/omega/issues/799)). A git
 * remote answers the repo the working tree SITS IN, which inside a brand nested
 * in another repo is the enclosing one, so the dispatch went to a workflow that
 * was never there. The rule is `@omega.js/devkit/deploy`'s `dispatchRepo`, the
 * same call web's deploy and desktop's release verbs make. Exported for tests.
 *
 * @returns {{ owner: string, repo: string }} owner and bare repo name
 * @throws {Error} when the config names no repo
 */
function dispatchAddress() {
  return dispatchRepo(Manager.getConfig());
}

module.exports.dispatchAddress = dispatchAddress;

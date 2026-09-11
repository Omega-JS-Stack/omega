/**
 * `omega deploy` — the explicit publish verb (D13: commits never
 * auto-publish). Delivers the brand to its repo and dispatches the scaffolded
 * publish workflow: CI builds, uploads to the stores when credentials are
 * present, and attaches the package zip to a GitHub release (the durable
 * artifact channel).
 *
 * ONE lane, the same one every target takes
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): the executor
 * resolves it from the brand: a nested or linked brand packs its local
 * frameworks and force-pushes a SNAPSHOT of the brand folder, an ordinary
 * brand commits and pushes, and then it waits for the workflow and dispatches. A
 * linked tree no longer switches itself to the direct lane; `--direct` is how a
 * human asks for that.
 *
 * Every run starts with the local scaffold the retired `omega setup` used to
 * own (ensureTarget, #675); a DISPATCH then runs setup's NETWORK half as a
 * precheck before it sends. `--no-secrets` skips that precheck, and `--direct`
 * never reaches it at all.
 *
 * Flags: --dry-run (print the exact dispatch, send nothing; skips the push),
 * --no-sync (dispatch without committing/pushing first: the push lane, and a linked own-repo brand's workflow sync),
 * --direct (build + store-publish from this machine: `npm run release`).
 */
const { execSync } = require('node:child_process');
const Manager = new (require('../build.js'));
const logger = Manager.logger('deploy');
const { deployViaDispatch, dispatchRepo } = require('@omega.js/devkit/deploy');
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

  // The direct lane, on request: build + store-publish from THIS machine.
  // BEFORE the precheck, which belongs to the CI lane (web and backend already
  // order it this way): a local deploy publishes nothing to the repo and needs
  // no `gh` session, so pushing this target's store credentials into Actions
  // secrets on the way past is exactly what it must not do (#872).
  if (options.direct) {
    return deployDirect({ dryRun, exec: options.exec });
  }

  // The NETWORK half, as a precheck: the CI lane needs the remote side right
  // (its secrets). A dry run sends nothing, so it prechecks nothing.
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

  // ONE lane for all four targets (#872): the executor resolves it from the
  // BRAND (`dir`): pack + snapshot push when the brand is nested or linked,
  // commit + push when it is neither, and then it waits for the workflow and
  // dispatches. `--no-sync` skips the push on both lanes that have one.
  const { owner, repo } = dispatchAddress();
  const { plan, dispatched, lane } = await deployViaDispatch({
    workflow: WORKFLOW,
    owner,
    repo,
    dir: process.cwd(),
    dryRun,
    sync: options.sync !== false,
    logger,
  });

  if (dispatched) {
    require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'extension', detail: { method: 'dispatch' } });
    logger.log(`Dispatched ${WORKFLOW} (${lane.mode} lane, ref ${lane.ref}): CI builds, publishes to stores, and attaches the zip to a GitHub release.`);
    logger.log(`Watch: ${plan.runsUrl}`);
  } else {
    logger.log(`DRY RUN (${lane.mode} lane, ref ${lane.ref}), would send:`);
    logger.log(`  ${plan.method} ${plan.url}`);
    logger.log(`  body: ${JSON.stringify(plan.body)}`);
    logger.log(`  then watch: ${plan.runsUrl}`);
  }
};

/**
 * The direct lane, asked for by a human (`--direct`,
 * [#872](https://github.com/Omega-JS-Stack/omega/issues/872)): build +
 * store-publish from THIS machine, with whatever frameworks are linked here
 * bundled in. It used to select itself whenever the tree carried a `file:`
 * spec, which took the CI lane away from the brands that need it most; a
 * linked brand now packs its frameworks into the snapshot the runner installs.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - Print what would run, run nothing.
 * @param {function} [options.exec] - Injectable shell (tests).
 * @returns {void}
 */
function deployDirect(options) {
  options = options || {};
  const exec = options.exec || execSync;

  if (options.dryRun) {
    return logger.log('DRY RUN, would run: npm run release (local build + store publish)');
  }

  logger.log('Building + publishing LOCALLY (store credentials must be available in this shell)...');
  exec('npm run release', { stdio: 'inherit' });
  require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'extension', detail: { method: 'direct' } });

  return logger.log('Deployed from the LOCAL build.');
}

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
module.exports.deployDirect = deployDirect;

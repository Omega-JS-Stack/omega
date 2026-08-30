/**
 * `omega deploy` — the uniform explicit publish verb (D13). Desktop's real
 * flow lives in `omega release` (workflow_dispatch + live CI log streaming +
 * GitHub-release artifacts); this verb exists so every target deploys the
 * same way. --dry-run prints the exact dispatch release would send, without
 * sending it; anything else delegates to release.
 *
 * Every run starts with the local scaffold the retired `omega setup` used to
 * own (ensureTarget, #675), delivers the Apple signing artifacts into the
 * target's certs dir (#678), and then runs setup's NETWORK half as a precheck:
 * framework freshness, cert validation, repo provisioning, secret publication.
 * `--no-secrets` skips that precheck.
 */
const { execSync } = require('node:child_process');
const Manager = new (require('../build.js'));
const logger = Manager.logger('deploy');
const { deployViaDispatch, findLocalSpecs } = require('@omega.js/devkit/deploy');
const { ensureTarget } = require('./lib/ensure-target.js');
const { deployPrecheck } = require('./lib/deploy-precheck.js');
const { deliverTargetCerts } = require('../utils/deliver-certs.js');

const WORKFLOW = 'build.yml';

module.exports = async function (options) {
  options = options || {};
  const dryRun = options.dryRun || options['dry-run'];
  const projectDir = process.cwd();

  // The local half of the retired `omega setup` (#675), then the signing
  // artifacts this target needs before anything signs (#678). Both are
  // idempotent and quiet on a converged target.
  await ensureTarget({ projectDir, log: (line) => logger.log(line), warn: (line) => logger.warn(line) });
  deliverTargetCerts({ projectDir, logger });

  // The NETWORK half, as a precheck: a deploy is the verb that needs the
  // remote side right. A dry run sends nothing, so it prechecks nothing.
  if (!dryRun) {
    await deployPrecheck({ projectDir, options, logger });
  }

  // Linked local packages (tree-wide file: specs — cp194) → the LOCAL
  // release flow automatically: build + sign + publish from this machine
  // with the linked frameworks bundled in. Mirrored rule (Ian 2026-07-20);
  // CI dispatch is only for registry-clean trees.
  if (findLocalSpecs({ dir: process.cwd() }).length > 0) {
    logger.log('Linked local packages detected — running the LOCAL release flow (build + sign + publish from this machine). CI dispatch resumes after `omega i live`.');
    if (dryRun) {
      logger.log('DRY RUN — would run: npm run release:local');
      return;
    }
    execSync('npm run release:local', { stdio: 'inherit' });
    require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'desktop', detail: { method: 'local' } });
    return logger.log('Deployed from the LOCAL release flow (linked frameworks included).');
  }

  if (dryRun) {
    const platforms = options.platforms || options.platform || 'all';
    const { plan } = await deployViaDispatch({
      workflow: WORKFLOW,
      inputs: { platforms: String(platforms) },
      dryRun: true,
    });
    logger.log('DRY RUN — would send:');
    logger.log(`  ${plan.method} ${plan.url}`);
    logger.log(`  body: ${JSON.stringify(plan.body)}`);
    logger.log(`  then watch: ${plan.runsUrl}`);
    return;
  }

  return require('./release.js')(options);
};

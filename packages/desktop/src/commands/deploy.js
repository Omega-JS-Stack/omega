/**
 * `omega deploy` — the uniform explicit publish verb (D13). Desktop's real
 * flow lives in `omega release` (workflow_dispatch + live CI log streaming +
 * GitHub-release artifacts); this verb exists so every target deploys the
 * same way. --dry-run prints the exact dispatch release would send, without
 * sending it; anything else delegates to release.
 *
 * Every run starts with the local scaffold the retired `omega setup` used to
 * own (ensureTarget, #675) and delivers the Apple signing artifacts into the
 * target's certs dir (#678). A DISPATCH then runs setup's NETWORK half as a
 * precheck: framework freshness, cert validation, repo provisioning, secret
 * publication. `--no-secrets` skips that precheck, and `--direct` never
 * reaches it at all.
 *
 * `--direct` is the direct lane, asked for by a human
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): `omega publish
 * --local` for THIS machine's platform. It used to select itself whenever the
 * tree was linked, which took the CI lane away from the brands that need it
 * most; a linked brand now packs its frameworks into the snapshot instead.
 */
const Manager = new (require('../build.js'));
const logger = Manager.logger('deploy');
const { deployViaDispatch } = require('@omega.js/devkit/deploy');
const { ensureTarget } = require('./lib/ensure-target.js');
const { deployPrecheck } = require('./lib/deploy-precheck.js');
const { deliverTargetCerts } = require('../utils/deliver-certs.js');
const { dispatchTarget } = require('./release.js');

module.exports = async function (options) {
  options = options || {};
  const dryRun = options.dryRun || options['dry-run'];
  const projectDir = process.cwd();

  // The local half of the retired `omega setup` (#675), then the signing
  // artifacts this target needs before anything signs (#678). Both are
  // idempotent and quiet on a converged target.
  await ensureTarget({ projectDir, log: (line) => logger.log(line), warn: (line) => logger.warn(line) });
  deliverTargetCerts({ projectDir, logger });

  // The direct lane: build + sign + publish from THIS machine, for this
  // machine's platform. A cross-platform build needs the runners CI has, so a
  // `--platforms` naming anything else is refused rather than silently built
  // for the host (#872).
  //
  // BEFORE the precheck, which belongs to the CI lane (web and backend already
  // order it this way): a local deploy publishes nothing to the repo and needs
  // no `gh` session, so pushing this target's signing certs into Actions
  // secrets on the way past is exactly what it must not do (#872).
  if (options.direct) {
    const platform = directPlatform(options.platforms || options.platform);

    if (dryRun) {
      logger.log(`DRY RUN, would run: omega publish --local (${platform}, this machine)`);
      return;
    }

    logger.log(`Building + publishing LOCALLY for ${platform} (signing credentials must be available on this machine)...`);
    await require('./publish.js')({ ...options, local: true });
    require('@omega.js/devkit/deploy-record').recordDeploy({ dir: process.cwd(), target: 'desktop', detail: { method: 'direct' } });
    return logger.log(`Deployed from the LOCAL publish (${platform}).`);
  }

  // The NETWORK half, as a precheck: the CI lane needs the remote side right
  // (its secrets, its repos). A dry run sends nothing, so it prechecks nothing.
  if (!dryRun) {
    await deployPrecheck({ projectDir, options, logger });
  }

  if (dryRun) {
    const platforms = options.platforms || options.platform || 'all';
    // The SAME address `omega release` dispatches on (config, and the composed
    // workflow name inside a brand), so the printed plan is the real one.
    const target = dispatchTarget({ projectRoot: projectDir, config: Manager.getConfig() });
    const { plan, lane } = await deployViaDispatch({
      workflow: target.workflow,
      owner: target.owner,
      repo: target.repo,
      dir: projectDir,
      inputs: { platforms: String(platforms) },
      dryRun: true,
    });
    logger.log(`DRY RUN (${lane.mode} lane, ref ${lane.ref}), would send:`);
    logger.log(`  ${plan.method} ${plan.url}`);
    logger.log(`  body: ${JSON.stringify(plan.body)}`);
    logger.log(`  then watch: ${plan.runsUrl}`);
    return;
  }

  return require('./release.js')(options);
};

// The platform each host can build for itself, in the workflow input's own
// vocabulary (the `platforms` dispatch input the setup job parses), plus the
// spellings that input accepts for it.
const HOST_PLATFORMS = {
  darwin: { name: 'mac', accepts: ['mac', 'darwin', 'macos'] },
  win32: { name: 'windows', accepts: ['win', 'windows'] },
  linux: { name: 'linux', accepts: ['linux', 'ubuntu'] },
};

/**
 * The platform a `--direct` deploy builds: this machine's, and only this
 * machine's. Electron cross-building (a signed Windows installer from a mac, a
 * DMG from linux) is what the CI matrix exists for, so a `--platforms` naming
 * anything but the host is an ERROR: building the host's platform instead
 * would publish an artifact nobody asked for.
 *
 * @param {string} [platforms] - The `--platforms`/`--platform` value ('all', 'mac,linux', …).
 * @param {string} [platform] - The host platform (defaults to process.platform).
 * @returns {string} The host platform's workflow name ('mac' | 'windows' | 'linux').
 * @throws {Error} When `platforms` names anything the host cannot build.
 */
function directPlatform(platforms, platform) {
  const host = HOST_PLATFORMS[platform || process.platform];

  if (!host) {
    throw new Error(`Unsupported host platform for \`omega deploy --direct\`: ${platform || process.platform}. Dispatch the CI build instead (\`omega deploy\`).`);
  }

  const asked = String(platforms || host.name).toLowerCase().split(',').map((value) => value.trim()).filter(Boolean);
  const foreign = asked.filter((value) => !host.accepts.includes(value));

  if (foreign.length > 0) {
    throw new Error(`\`omega deploy --direct\` builds on THIS machine, so it can only build ${host.name}: ${foreign.join(', ')} ${foreign.length === 1 ? 'is' : 'are'} CI-only. Run \`omega deploy\` (no --direct) to build every platform on the runners.`);
  }

  return host.name;
}

module.exports.directPlatform = directPlatform;

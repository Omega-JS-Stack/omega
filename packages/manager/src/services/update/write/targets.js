/**
 * Install + build every target-mapped dir.
 *
 * Install is ONE `npm install` at the brand root (npm workspaces cover every
 * target), and it's dependency-resolution-gated for idempotency: if every
 * target's
 * declared deps already resolve through the node_modules climb, the install
 * is skipped — so a second run is a no-op, and a brand nested inside a larger
 * workspace (the monorepo's sandbox brand) never grows a stray node_modules.
 *
 * Build runs each target's own `npm run build`; targets without a build script are
 * recorded as skipped, not failed (a backend's "build" is its deploy story).
 * Those builds are the slow tail of every walk, so they are INCREMENTAL
 * (#445): a target whose own files AND whose installed `@omega.js/*` frameworks
 * are both unchanged since its last successful build is converged and skips
 * with one line (lib/fingerprint.js), the fingerprint pair living in
 * `.omega/cache/update.json` (lib/cache.js). Either set fresh → the full build
 * for that target; `--force` ignores the cache, and so does a brand whose cache
 * is missing or unreadable.
 *
 * Output shape matches omega-manager's update service so RunSummary's
 * drill-down works unchanged: { results: { [target]: { steps: [{ phase,
 * success, error?, skipped? }] } } }.
 */
const path = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { runCommand } = require('../../../lib/run-command.js');
const { readCompanyMarker } = require('../../../lib/company.js');
const { fingerprintTarget, resolvePackageDir } = require('../lib/fingerprint.js');
const { readCache, writeCache, CACHE_VERSION } = require('../lib/cache.js');

/**
 * The merge-chain files OUTSIDE the target tree that its build still reads:
 * brand config/.env, and the company pair when the brand carries a marker.
 * A brand-config edit must dirty every target's fingerprint, or the
 * converged skip serves stale output.
 */
function chainFiles(brandRoot) {
  const files = [
    { label: 'brand-config', file: path.join(brandRoot, 'config', 'omega.json5') },
    { label: 'brand-env', file: path.join(brandRoot, '.env') },
  ];

  const marker = readCompanyMarker(brandRoot);
  if (marker) {
    files.push(
      { label: 'company-config', file: path.join(marker.companyRoot, 'config', 'omega.json5') },
      { label: 'company-env', file: path.join(marker.companyRoot, '.env') },
    );
  }

  return files;
}

/**
 * Collect declared deps (dependencies + devDependencies) missing from an
 * target's resolution climb.
 */
function missingDeps(targetPath) {
  const pkg = jetpack.read(path.join(targetPath, 'package.json'), 'json');
  if (!pkg) return [];

  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  return declared.filter((name) => !resolvePackageDir(targetPath, name));
}

module.exports = async ({ brandRoot, targets, options }) => {
  const mappedTargets = targets.filter((entry) => entry.target);
  const results = {};
  let failed = false;

  // ─── Install phase (once, at the brand root) ──────────────────────────────
  const missing = mappedTargets.flatMap((entry) => missingDeps(entry.path).map((dep) => `${entry.name}:${dep}`));
  const installSteps = [];

  if (missing.length === 0) {
    console.log(`      ${chalk.dim('⊘ install: all dependencies resolve')}`);
    installSteps.push({ phase: 'install', success: true, skipped: true });
  } else if (options.dryRun) {
    console.log(`      ${chalk.yellow('⊘')} install: would run npm install ${chalk.dim(`(missing: ${missing.join(', ')})`)} ${chalk.dim('[DRY RUN]')}`);
    installSteps.push({ phase: 'install', success: true, skipped: true, dryRun: true });
  } else {
    console.log(`      ${chalk.dim('→')} npm install ${chalk.dim(`(missing: ${missing.join(', ')})`)}`);
    const result = await runCommand('npm', ['install', '--no-audit', '--no-fund'], brandRoot);
    installSteps.push({ phase: 'install', ...result });
    if (!result.success) {
      failed = true;
      // Local-first era: the frameworks aren't on the registry yet
      if (missing.some((entry) => entry.includes('@omega.js/'))) {
        console.log(`      ${chalk.yellow('⚠')} @omega.js/* packages are not published yet — link them per target with ${chalk.bold('mgr i local')} (or a workspace/file: reference).`);
      }
    }
  }

  results.root = { steps: installSteps };

  // ─── Build phase (per target, incremental) ────────────────────────────────
  const cache = readCache(brandRoot);
  const chain = chainFiles(brandRoot);
  const nextTargets = {};

  for (const entry of mappedTargets) {
    const steps = [];
    const cached = cache.targets[entry.name];

    if (failed) {
      // Nothing was rebuilt, so last run's verdict for this target still stands
      if (cached) nextTargets[entry.name] = cached;
      steps.push({ phase: 'build', success: true, skipped: true, reason: 'install failed' });
      results[entry.name] = { steps };
      continue;
    }

    const pkg = jetpack.read(path.join(entry.path, 'package.json'), 'json');
    // Only worth sweeping when there's a cached verdict to compare against
    // and the run is allowed to honour it
    const fingerprint = cached && pkg?.scripts?.build && !options.force
      ? fingerprintTarget(entry.path, chain)
      : null;
    const converged = Boolean(fingerprint)
      && cached.files === fingerprint.files
      && cached.frameworks === fingerprint.frameworks;

    if (!pkg?.scripts?.build) {
      console.log(`      ${chalk.dim(`⊘ ${entry.name}: no build script`)}`);
      steps.push({ phase: 'build', success: true, skipped: true, reason: 'no build script' });
    } else if (converged) {
      console.log(`      ${chalk.dim(`⊘ ${entry.name}: converged (target files + @omega.js/* unchanged)`)}`);
      nextTargets[entry.name] = cached;
      steps.push({ phase: 'build', success: true, skipped: true, reason: 'converged' });
    } else if (options.dryRun) {
      console.log(`      ${chalk.yellow('⊘')} ${entry.name}: would run npm run build ${chalk.dim('[DRY RUN]')}`);
      steps.push({ phase: 'build', success: true, skipped: true, dryRun: true });
    } else {
      // Non-interactive runs (pipeline, CI, and `omega dev`'s boot manage
      // cycle — #228) must be deterministic: web builds use the committed
      // translation cache only — never a live LLM pass mid-run (the same law
      // deploys follow). New strings translate on the next interactive run.
      const buildArgs = ['run', 'build'];
      if (entry.target === 'web' && process.env.OMEGA_NON_INTERACTIVE === '1') {
        buildArgs.push('--', '--cached-only');
      }
      console.log(`      ${chalk.dim('→')} ${entry.name}: npm ${buildArgs.join(' ')}`);
      const result = await runCommand('npm', buildArgs, entry.path);
      steps.push({ phase: 'build', ...result });

      if (result.success) {
        // Re-fingerprint AFTER the build: a build that writes back into its
        // own sources (the web translation cache) would otherwise leave the
        // target looking fresh forever. A failed build records nothing, so the
        // next run retries it.
        nextTargets[entry.name] = { ...fingerprintTarget(entry.path, chain), updatedAt: new Date().toISOString() };
      } else {
        failed = true;
      }
    }

    results[entry.name] = { steps };
  }

  // One write, only when something moved (a build landed, a target left the
  // brand, or the file was missing/unreadable and this rebuilds it). Keys are
  // sorted so a converged rerun produces the byte-identical file it read.
  const nextCache = {
    version: CACHE_VERSION,
    targets: Object.fromEntries(Object.keys(nextTargets).sort().map((name) => [name, nextTargets[name]])),
  };

  if (!options.dryRun && JSON.stringify(nextCache) !== JSON.stringify(cache)) {
    writeCache(brandRoot, nextCache);
  }

  return {
    status: failed ? 'error' : 'success',
    output: { results },
  };
};

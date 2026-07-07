/**
 * Install + build every target-mapped app.
 *
 * Install is ONE `npm install` at the brand root (npm workspaces cover every
 * app), and it's dependency-resolution-gated for idempotency: if every app's
 * declared deps already resolve through the node_modules climb, the install
 * is skipped — so a second run is a no-op, and a brand nested inside a larger
 * workspace (the monorepo's sandbox brand) never grows a stray node_modules.
 *
 * Build runs each app's own `npm run build`; apps without a build script are
 * recorded as skipped, not failed (a backend's "build" is its deploy story).
 *
 * Output shape matches omega-manager's update service so RunSummary's
 * drill-down works unchanged: { results: { [app]: { steps: [{ phase,
 * success, error?, skipped? }] } } }.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

/**
 * Does `name` resolve from `fromDir` via the node_modules directory climb?
 * A manual walk (not require.resolve) so exports-restricted packages and
 * bin-only packages don't false-negative.
 */
function isDepInstalled(fromDir, name) {
  let dir = path.resolve(fromDir);

  while (true) {
    if (fs.existsSync(path.join(dir, 'node_modules', name))) {
      return true;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Collect declared deps (dependencies + devDependencies) missing from an
 * app's resolution climb.
 */
function missingDeps(appPath) {
  const pkg = jetpack.read(path.join(appPath, 'package.json'), 'json');
  if (!pkg) return [];

  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  return declared.filter((name) => !isDepInstalled(appPath, name));
}

/**
 * Run a command in a directory, streaming output. Resolves { success, error? }.
 */
function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: 'inherit' });

    child.on('close', (code) => {
      resolve(code === 0
        ? { success: true }
        : { success: false, error: `exit code ${code}` });
    });

    child.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

module.exports = async ({ brandRoot, apps, options }) => {
  const targetApps = apps.filter((app) => app.target);
  const results = {};
  let failed = false;

  // ─── Install phase (once, at the brand root) ──────────────────────────────
  const missing = targetApps.flatMap((app) => missingDeps(app.path).map((dep) => `${app.name}:${dep}`));
  const installSteps = [];

  if (missing.length === 0) {
    console.log(`      ${chalk.dim('⊘ install: all dependencies resolve')}`);
    installSteps.push({ phase: 'install', success: true, skipped: true });
  } else if (options.dryRun) {
    console.log(`      ${chalk.yellow('⊘')} install: would run npm install ${chalk.dim(`(missing: ${missing.join(', ')})`)} ${chalk.dim('[dry-run]')}`);
    installSteps.push({ phase: 'install', success: true, skipped: true, dryRun: true });
  } else {
    console.log(`      ${chalk.dim('→')} npm install ${chalk.dim(`(missing: ${missing.join(', ')})`)}`);
    const result = await runCommand('npm', ['install', '--no-audit', '--no-fund'], brandRoot);
    installSteps.push({ phase: 'install', ...result });
    if (!result.success) failed = true;
  }

  results.root = { steps: installSteps };

  // ─── Build phase (per app) ────────────────────────────────────────────────
  for (const app of targetApps) {
    const steps = [];

    if (failed) {
      steps.push({ phase: 'build', success: true, skipped: true, reason: 'install failed' });
      results[app.name] = { steps };
      continue;
    }

    const pkg = jetpack.read(path.join(app.path, 'package.json'), 'json');

    if (!pkg?.scripts?.build) {
      console.log(`      ${chalk.dim(`⊘ ${app.name}: no build script`)}`);
      steps.push({ phase: 'build', success: true, skipped: true, reason: 'no build script' });
    } else if (options.dryRun) {
      console.log(`      ${chalk.yellow('⊘')} ${app.name}: would run npm run build ${chalk.dim('[dry-run]')}`);
      steps.push({ phase: 'build', success: true, skipped: true, dryRun: true });
    } else {
      console.log(`      ${chalk.dim('→')} ${app.name}: npm run build`);
      const result = await runCommand('npm', ['run', 'build'], app.path);
      steps.push({ phase: 'build', ...result });
      if (!result.success) failed = true;
    }

    results[app.name] = { steps };
  }

  return {
    status: failed ? 'error' : 'success',
    output: { results },
  };
};

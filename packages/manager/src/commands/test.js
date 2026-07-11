/**
 * `omega test` at a brand root — C5's brand layer: fan the test run out over
 * the brand's apps, each in its own framework's hands.
 *
 *   omega test                → every app's PROJECT tests (bare per app)
 *   omega test framework:     → every app's framework suite
 *   omega test full:          → both sources, every app
 *   omega test routes/x       → project filter, forwarded to every app
 *                               (apps with no matching tests no-op)
 *   omega test web:pages/     → ONLY the web app — its framework suite, scoped
 *   omega test em:            → ONLY the desktop app's framework suite
 *
 * Universal targets (bare paths, `framework:`/`omega:`/`mgr:`, `full:`,
 * `project:`/`brand:`) forward to every app verbatim; per-framework ids
 * (FRAMEWORK_IDS: `web:`/`ujm:`, `backend:`, `desktop:`/`em:`,
 * `extension:`/`bxm:`) route to the app owning that framework. Unknown
 * prefixes warn and are dropped; if nothing valid remains, every app runs
 * bare (scope.js parity). Flags are NOT fanned out — flagged runs
 * (--layer, --extended) are app-level invocations; run them from the app.
 *
 * Apps run sequentially with streamed output; any failing app → exit 1.
 */
const fs = require('node:fs');
const path = require('node:path');
const chalk = require('chalk').default;

const { findTarget } = require('@omega.js/devkit/omega-bin');
const { UNIVERSAL_FRAMEWORK_ALIASES, PROJECT_ALIASES, FULL_ALIASES, FRAMEWORK_IDS } = require('@omega.js/devkit/test/scope');
const { resolveBrandRoot, discoverApps } = require('../lib/brand.js');
const { runCommand } = require('../lib/run-command.js');

// Prefixes forwarded to every app as-is (each app's own C5 parser interprets them)
const UNIVERSAL_PREFIXES = new Set([
  ...UNIVERSAL_FRAMEWORK_ALIASES,
  ...PROJECT_ALIASES,
  ...FULL_ALIASES,
]);

// id prefix → owning framework package ('em' → '@omega.js/desktop', …)
const ID_TO_FRAMEWORK = Object.fromEntries(
  Object.entries(FRAMEWORK_IDS).flatMap(([pkg, ids]) => ids.map((id) => [id, pkg]))
);

/**
 * Split raw targets into per-app routing: `shared` goes to every app,
 * `perFramework[pkg]` only to the app owning that framework, `invalid`
 * is warned and dropped.
 */
function partitionTargets(rawTargets) {
  const shared = [];
  const perFramework = {};
  const invalid = [];

  for (const raw of rawTargets) {
    const target = String(raw).trim();
    if (!target) continue;

    // Same prefix grammar as scope.js (lowercase-only keeps C:/ paths bare)
    const match = target.match(/^([a-z-]+):/);

    if (!match) {
      shared.push(target);
    } else if (UNIVERSAL_PREFIXES.has(match[1])) {
      shared.push(target);
    } else if (ID_TO_FRAMEWORK[match[1]]) {
      const pkg = ID_TO_FRAMEWORK[match[1]];
      (perFramework[pkg] = perFramework[pkg] || []).push(target);
    } else {
      invalid.push(target);
    }
  }

  return { shared, perFramework, invalid };
}

/**
 * Resolve a framework's `omega` bin FILE via the node_modules directory climb
 * from where the app declares it. A manual walk (not require.resolve) because
 * exports-restricted packages don't expose ./package.json.
 */
function resolveFrameworkBin(fromDir, name) {
  let dir = path.resolve(fromDir);

  while (true) {
    const pkgDir = path.join(dir, 'node_modules', name);
    const pkgPath = path.join(pkgDir, 'package.json');

    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin || {}).omega;
      return bin ? path.join(pkgDir, bin) : null;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

module.exports = async (options) => {
  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run inside a brand, or inside an app for that app\'s tests.'));
    process.exitCode = 1;
    return;
  }

  // Positional targets — tolerate both `omega-manager test x` (command token
  // present) and flag-alias entry (`--test x`, no token).
  const rawTargets = (options._ || []).map(String);
  if (rawTargets[0] === 'test') rawTargets.shift();

  const { shared, perFramework, invalid } = partitionTargets(rawTargets);
  for (const bad of invalid) {
    console.log(chalk.yellow(`  ⚠ Unknown test scope prefix ignored: ${bad}`));
  }

  // Nothing valid → every app runs bare (its project tests), scope.js parity.
  const runAllBare = shared.length === 0 && Object.keys(perFramework).length === 0;

  const apps = discoverApps(brandRoot).filter((app) => app.target);
  if (apps.length === 0) {
    console.log(chalk.yellow('⚠ No target-mapped apps under apps/ — nothing to test.'));
    return;
  }

  console.log(chalk.bold(`\nOMEGA brand tests — ${path.basename(brandRoot)}`));

  // ─── Plan: which apps run, with which forwarded targets ───────────────────
  const runs = [];

  for (const app of apps) {
    const target = findTarget(app.path);

    if (!target || target.kind !== 'framework') {
      // Only an error if this app was (or would be) addressed
      if (runAllBare || shared.length > 0) {
        runs.push({ app, error: 'no framework dependency detected (package.json / functions/package.json)' });
      }
      continue;
    }

    const args = [...shared, ...(perFramework[target.name] || [])];
    if (!runAllBare && args.length === 0) continue; // targeted run, not addressed to this app

    const binPath = resolveFrameworkBin(target.dir, target.name);
    if (!binPath) {
      runs.push({ app, error: `${target.name} is not installed (node_modules climb from ${target.dir} found no bin)` });
      continue;
    }

    runs.push({ app, framework: target.name, binPath, args });
  }

  if (runs.length === 0) {
    console.log(chalk.yellow('⚠ No app matches the requested scope — nothing ran.'));
    return;
  }

  // ─── Execute sequentially, streaming each app's output ────────────────────
  const summary = [];
  let failed = false;

  for (const [index, run] of runs.entries()) {
    const label = `[${index + 1}/${runs.length}] ${run.app.name}`;

    if (run.error) {
      console.log(chalk.red(`\n✗ ${label}: ${run.error}`));
      summary.push({ name: run.app.name, ok: false, detail: run.error });
      failed = true;
      continue;
    }

    console.log(chalk.cyan(`\n─── ${label} ${chalk.dim(`(${run.framework})`)} — omega test ${run.args.join(' ')}`.trimEnd() + ' ───'));
    const result = await runCommand(process.execPath, [run.binPath, 'test', ...run.args], run.app.path);

    summary.push({ name: run.app.name, ok: result.success, detail: result.error });
    if (!result.success) failed = true;
  }

  // ─── Summary + aggregate exit ──────────────────────────────────────────────
  console.log(chalk.bold('\nTest summary'));
  for (const entry of summary) {
    console.log(entry.ok
      ? `  ${chalk.green('✓')} ${entry.name}`
      : `  ${chalk.red('✗')} ${entry.name} ${chalk.dim(`— ${entry.detail}`)}`);
  }

  if (failed) {
    process.exitCode = 1;
  }
};

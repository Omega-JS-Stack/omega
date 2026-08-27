/**
 * `omega test` at a brand root — C5's brand layer: fan the test run out over
 * the brand's targets, each in its own framework's hands.
 *
 *   omega test                → every target's PROJECT tests (bare per target)
 *   omega test framework:     → every target's framework suite
 *   omega test full:          → both sources, every target
 *   omega test routes/x       → project filter, forwarded to every target
 *                               (targets with no matching tests no-op)
 *   omega test web:pages/     → ONLY the web target — its framework suite, scoped
 *   omega test desktop:       → ONLY the desktop target's framework suite
 *
 * Universal targets (bare paths, `framework:`/`omega:`/`mgr:`, `full:`,
 * `project:`/`brand:`) forward to every target verbatim; per-framework ids
 * (FRAMEWORK_IDS: `web:`, `backend:`, `desktop:`, `extension:`) route to
 * the target owning that framework — the legacy short ids are retired. Unknown
 * prefixes warn and are dropped; if nothing valid remains, every target runs
 * bare (scope.js parity). Flags are NOT fanned out — flagged runs
 * (--layer, --extended) are target-level invocations; run them from the target.
 *
 * Targets run sequentially with streamed output; any failing target → exit 1.
 */
const path = require('node:path');
const chalk = require('chalk').default;

const { UNIVERSAL_FRAMEWORK_ALIASES, PROJECT_ALIASES, FULL_ALIASES, FRAMEWORK_IDS } = require('@omega.js/devkit/test/scope');
const { resolveBrandRoot, discoverTargets } = require('../lib/brand.js');
const { resolveTargetRun } = require('../lib/framework-bin.js');
const { runCommand } = require('../lib/run-command.js');

// Prefixes forwarded to every target as-is (each target's own C5 parser interprets them)
const UNIVERSAL_PREFIXES = new Set([
  ...UNIVERSAL_FRAMEWORK_ALIASES,
  ...PROJECT_ALIASES,
  ...FULL_ALIASES,
]);

// id prefix → owning framework package ('desktop' → '@omega.js/desktop', …)
const ID_TO_FRAMEWORK = Object.fromEntries(
  Object.entries(FRAMEWORK_IDS).flatMap(([pkg, ids]) => ids.map((id) => [id, pkg]))
);

/**
 * Split raw targets into per-target routing: `shared` goes to every target,
 * `perFramework[pkg]` only to the target owning that framework, `invalid`
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

module.exports = async (options) => {
  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run inside a brand, or inside a target for that target\'s tests.'));
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

  // Nothing valid → every target runs bare (its project tests), scope.js parity.
  const runAllBare = shared.length === 0 && Object.keys(perFramework).length === 0;

  const targets = discoverTargets(brandRoot).filter((entry) => entry.target || entry.custom);
  if (targets.length === 0) {
    console.log(chalk.yellow('⚠ No target-mapped dirs under targets/ — nothing to test.'));
    return;
  }

  console.log(chalk.bold(`\nOMEGA brand tests — ${path.basename(brandRoot)}`));

  // ─── Plan: which targets run, with which forwarded ids ────────────────────
  const runs = [];

  for (const entry of targets) {
    const run = resolveTargetRun(entry, 'test');

    // A target whose tests ARE its own `npm run test` — a custom target
    // (#603), or a backend in custom-server mode whose framework has no
    // emulator lane to run (#584) — never hears the scope vocabulary: it is
    // the frameworks', and means nothing to a package script. So a SCOPED run
    // never addresses one, a bare run does, and nothing is forwarded.
    if (run.kind === 'custom' || run.kind === 'skip') {
      if (!runAllBare) continue;

      if (run.kind === 'skip') {
        console.log(chalk.dim(`  ⊘ ${entry.name}: ${run.detail} — skipped`));
        continue;
      }

      runs.push({ entry, framework: 'custom', command: run.command, args: run.args, label: run.label });
      continue;
    }

    if (run.kind === 'error') {
      // Only an error if this target was (or would be) addressed
      if (runAllBare || shared.length > 0) {
        runs.push({ entry, error: run.detail });
      }
      continue;
    }

    const args = [...shared, ...(perFramework[run.framework] || [])];
    if (!runAllBare && args.length === 0) continue; // targeted run, not addressed to this target

    runs.push({ entry, framework: run.framework, command: run.command, args: [...run.args, ...args], label: `omega test ${args.join(' ')}`.trimEnd() });
  }

  if (runs.length === 0) {
    console.log(chalk.yellow('⚠ No target matches the requested scope — nothing ran.'));
    return;
  }

  // ─── Execute sequentially, streaming each target's output ─────────────────
  const summary = [];
  let failed = false;

  for (const [index, run] of runs.entries()) {
    const label = `[${index + 1}/${runs.length}] ${run.entry.name}`;

    if (run.error) {
      console.log(chalk.red(`\n✗ ${label}: ${run.error}`));
      summary.push({ name: run.entry.name, ok: false, detail: run.error });
      failed = true;
      continue;
    }

    console.log(chalk.cyan(`${`\n─── ${label} ${chalk.dim(`(${run.framework})`)} — ${run.label}`.trimEnd()} ───`));
    const result = await runCommand(run.command, run.args, run.entry.path);

    summary.push({ name: run.entry.name, ok: result.success, detail: result.error });
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

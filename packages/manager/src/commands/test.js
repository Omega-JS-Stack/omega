/**
 * `omega test` at a brand root — C5's brand layer: fan the test run out over
 * the brand's targets, each in its own framework's hands, and then run the
 * brand's OWN e2e lane.
 *
 *   omega test                → every target's PROJECT tests, then test/e2e/
 *   omega test framework:     → every target's framework suite
 *   omega test full:          → both sources, every target
 *   omega test routes/x       → project filter, forwarded to every target
 *                               (a target with no matching tests no-ops; a
 *                                path NO target carries fails the run, #814)
 *   omega test web:pages/     → ONLY the web target — its framework suite, scoped
 *   omega test desktop:       → ONLY the desktop target's framework suite
 *   omega test --target=web,backend  → narrow ANY of the above to those targets
 *   omega test --extended     → fanned out: every target runs its real-service suites
 *   omega test --lane=<name>  → fanned out to the targets that DECLARE that lane
 *
 * Universal targets (bare paths, `framework:`/`omega:`/`mgr:`, `full:`,
 * `project:`/`brand:`) forward to every target verbatim; per-framework ids
 * (FRAMEWORK_IDS: `web:`, `backend:`, `desktop:`, `extension:`) route to
 * the target owning that framework — the legacy short ids are retired. Unknown
 * prefixes warn and are dropped; if nothing valid remains, every target runs
 * bare (scope.js parity).
 *
 * `--target=<a,b>` is the TARGET picker, and it composes with every scope
 * above rather than replacing any of them: a comma list of target keys ('web')
 * or dir names ('website') narrowing which targets the run reaches. A
 * per-framework id already names its target, so an id whose owner the picker
 * excludes is a contradiction, not a narrowing — it refuses by name instead of
 * running the empty intersection.
 *
 * MODE flags fan out ([#775](https://github.com/Omega-JS-Stack/omega/issues/775)):
 * `--extended` (real external services) reaches every framework target, and
 * `--lane=<name>` reaches the targets whose framework DECLARES that lane in
 * its package.json `omega.testLanes` — a target that declares none prints one
 * line and the run stays green, because an opt-in lane no framework serves is
 * a lane that does not apply there, never a failure. Path-scope flags
 * (`--layer`) stay target-level invocations.
 *
 * The BRAND E2E LANE (`<brandRoot>/test/e2e/run.js`) runs last, when it
 * exists: one browser lane driving the brand's real pages against its real
 * local stack, which is a brand-level surface no target owns. It is a runner
 * script, so — exactly like a custom target's `test` script — it hears no
 * scope vocabulary and no flags: a bare run reaches it, and a scoped,
 * picked (`--target=`) or laned run never does.
 *
 * Targets run sequentially with streamed output; any failing target → exit 1.
 */
const fs = require('node:fs');
const path = require('node:path');
const chalk = require('chalk').default;
const attachLogFile = require('@omega.js/devkit/attach-log-file');

const Logger = require('@omega.js/devkit/logger');
const { UNIVERSAL_FRAMEWORK_ALIASES, PROJECT_ALIASES, FULL_ALIASES, FRAMEWORK_IDS, FANOUT_ENV, NO_MATCH_EXIT_CODE, noMatchMessage, parseTestScope, isPathTargeted } = require('@omega.js/devkit/test/scope');
const { resolveBrandRoot, discoverTargets } = require('../lib/brand.js');
const { resolveTargetRun, resolveFrameworkPackage } = require('../lib/framework-bin.js');
const { PICKER_FLAG, assertPickerFlags, assertKnownTargets, parseTargetTokens, targetMatches } = require('../lib/target-selection.js');
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

// The brand's own e2e lane — ONE entry file, by convention, so the walk never
// has to guess which of a directory's files is the runner and which are its
// helpers (#775).
const BRAND_E2E_DIR = path.join('test', 'e2e');
const BRAND_E2E_ENTRY = path.join(BRAND_E2E_DIR, 'run.js');

// The fan-out's own verdict is a log line, not a report row: the report says
// what each target did, this says what the RUN means (#814).
const logger = new Logger('test');

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

/**
 * The brand root's targets read through the SAME grammar a target's own runner
 * reads them with, so "did this run name a path?" means one thing everywhere
 * ([#814](https://github.com/Omega-JS-Stack/omega/issues/814)). Every framework
 * id is handed in as an alias, since at this layer they all name a source.
 *
 * @param {string[]} rawTargets - The positional targets, as typed
 * @returns {object} A parseTestScope() result
 */
function namedScope(rawTargets) {
  return parseTestScope(rawTargets, { frameworkAliases: Object.keys(ID_TO_FRAMEWORK) });
}

/**
 * The `--target=` picker: which discovered targets a run may reach.
 * Tokens match a target's key ('web') or its dir name ('website') through the
 * shared matcher every brand-root picker uses (lib/target-selection.js,
 * which also names the flag: ONE `--target=` on every verb, #780).
 *
 * @param {Array} targets - the discovered target entries
 * @param {string} [picker] - the raw --target value (comma list)
 * @returns {{ tokens: string[], selected: Array }}
 * @throws {Error} when a token matches no target
 */
function pickTargets(targets, picker) {
  const tokens = parseTargetTokens(picker);
  if (tokens.length === 0) {
    return { tokens, selected: targets };
  }

  assertKnownTargets(
    tokens.filter((token) => !targets.some((entry) => targetMatches(entry, token))),
    targets.map((entry) => entry.target || entry.name),
  );
  const selected = targets.filter((entry) => tokens.some((token) => targetMatches(entry, token)));

  return { tokens, selected };
}

/**
 * Does this target's framework declare `lane`? The framework's package.json
 * `omega.testLanes` is the SSOT — a lane is the framework's to own, and the
 * brand root only needs to know which targets it applies to.
 *
 * @param {object} entry - the discovered target entry
 * @param {string} framework - the framework package name
 * @param {string} lane - the --lane value
 * @returns {boolean}
 */
function declaresLane(entry, framework, lane) {
  const resolved = resolveFrameworkPackage(entry.path, framework);
  const lanes = resolved?.pkg?.omega?.testLanes;
  return Array.isArray(lanes) && lanes.includes(lane);
}

module.exports = async (options) => {
  assertPickerFlags(options);

  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run inside a brand, or inside a target for that target\'s tests.'));
    process.exitCode = 1;
    return;
  }

  // Tee the whole fan-out to <brandRoot>/logs/test.log (#623) — which target
  // ran which scope, and the aggregate verdict (each target's own suite output
  // stays in targets/<target>/logs/test.log).
  attachLogFile(path.join(brandRoot, 'logs', 'test.log'));

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
  const lane = options.lane ? String(options.lane) : null;
  const extended = !!options.extended;

  const discovered = discoverTargets(brandRoot).filter((entry) => entry.target || entry.custom);
  if (discovered.length === 0) {
    console.log(chalk.yellow('⚠ No target-mapped dirs under targets/ — nothing to test.'));
    return;
  }

  const picked = pickTargets(discovered, options[PICKER_FLAG]);

  console.log(chalk.bold(`\nOMEGA brand tests — ${path.basename(brandRoot)}`));

  // ─── Plan: which targets run, with which forwarded ids ────────────────────
  const runs = [];

  // Resolved ONCE per target: the plan below and the --target/id contradiction
  // check both need to know which framework owns which target.
  const resolvedRuns = discovered.map((entry) => ({ entry, run: resolveTargetRun(entry, 'test') }));

  // A per-framework id names its target; a picker that excludes that target
  // contradicts it. Refuse by name rather than run the empty intersection —
  // silently testing nothing is the outcome a green exit must never mean.
  for (const [pkg, ids] of Object.entries(perFramework)) {
    const owner = resolvedRuns.find((item) => item.run.framework === pkg);
    if (!owner || picked.selected.includes(owner.entry)) continue;

    const error = new Error(
      `omega test: refusing --${PICKER_FLAG}=${picked.tokens.join(',')} beside the "${ids[0]}" scope — `
      + `${owner.entry.dir} owns that framework and --${PICKER_FLAG} excludes it. Nothing ran.\n`
      + 'Name the same target on both, or drop one of them.',
    );
    error.refusal = true;
    throw error;
  }

  for (const { entry, run } of resolvedRuns) {
    if (!picked.selected.includes(entry)) continue;

    // A target whose tests ARE its own `npm run test` — a custom target
    // (#603), or a backend in custom-server mode whose framework has no
    // emulator lane to run (#584) — never hears the scope vocabulary: it is
    // the frameworks', and means nothing to a package script. So a SCOPED run
    // never addresses one, a bare run does, and nothing is forwarded.
    if (run.kind === 'custom' || run.kind === 'skip') {
      // A lane is scope too — an opt-in lane a framework declares means
      // nothing to a package script, so a laned run never addresses one.
      if (!runAllBare || lane) continue;

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

    // An opt-in lane reaches only the frameworks that serve it; the rest say
    // so in one line and the run stays green (#775).
    if (lane && !declaresLane(entry, run.framework, lane)) {
      console.log(chalk.dim(`  ⊘ ${entry.name}: no "${lane}" lane in ${run.framework} — skipped`));
      continue;
    }

    const args = [...shared, ...(perFramework[run.framework] || [])];
    if (!runAllBare && args.length === 0) continue; // targeted run, not addressed to this target

    // MODE flags ride the same `forwarded` seam every other brand-root fan-out
    // uses (commands/deploy.js, lib/verb-fanout.js), so the flags land where
    // that one place decides they land. Re-resolved only when there ARE flags:
    // a bare run has nothing to forward and keeps its first resolution.
    const forwarded = [
      ...(extended ? ['--extended'] : []),
      ...(lane ? [`--lane=${lane}`] : []),
    ];
    const flagged = forwarded.length ? resolveTargetRun(entry, 'test', forwarded) : run;

    runs.push({
      entry,
      framework: flagged.framework,
      command: flagged.command,
      args: [...flagged.args, ...args],
      label: `omega test ${[...forwarded, ...args].join(' ')}`.trimEnd(),
      // This target is being ASKED, not chosen: a path it does not carry is a
      // no-op here, and the signal is what lets its CLI say so with a code of
      // its own instead of failing the whole brand run (#814).
      env: { [FANOUT_ENV]: '1' },
    });
  }

  // ─── The brand's own e2e lane, after the targets ───────────────────────────
  // A bare run only: it is a runner script with no scope vocabulary and no
  // flags, so a scoped, picked or laned run is asking for something else.
  const brandLane = path.join(brandRoot, BRAND_E2E_ENTRY);
  if (runAllBare && !lane && picked.tokens.length === 0 && fs.existsSync(path.join(brandRoot, BRAND_E2E_DIR))) {
    if (fs.existsSync(brandLane)) {
      runs.push({
        entry: { name: BRAND_E2E_DIR, path: brandRoot },
        framework: 'brand',
        command: process.execPath,
        args: [brandLane],
        label: `node ${BRAND_E2E_ENTRY}`,
      });
    } else {
      console.log(chalk.dim(`  ⊘ ${BRAND_E2E_DIR}: no ${path.basename(BRAND_E2E_ENTRY)} entry — skipped`));
    }
  }

  if (runs.length === 0) {
    console.log(chalk.yellow('⚠ No target matches the requested scope — nothing ran.'));

    // Nothing ran AND a path was named: the brand carries no target that could
    // even be asked for it, which is the same typo the target-level rule
    // catches, so it fails here too ([#814](https://github.com/Omega-JS-Stack/omega/issues/814)).
    // A bare prefix (`desktop:` with no path) names no file, so it keeps the
    // warning above and an exit 0.
    if (isPathTargeted(namedScope(rawTargets))) {
      logger.error(noMatchMessage(rawTargets.join(' ')));
      process.exitCode = 1;
    }
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
    const result = await runCommand(run.command, run.args, run.entry.path, run.env);

    // The distinct no-match code (#814): this target does not carry the path
    // the brand root forwarded, which is a no-op here, not a failure. The run
    // as a whole still has to answer for it below.
    const missed = !result.success && result.code === NO_MATCH_EXIT_CODE;

    summary.push({ name: run.entry.name, ok: result.success, missed, detail: missed ? 'no test file matches' : result.error });
    if (!result.success && !missed) failed = true;
  }

  // ─── Summary + aggregate exit ──────────────────────────────────────────────
  console.log(chalk.bold('\nTest summary'));
  for (const entry of summary) {
    if (entry.missed) {
      console.log(`  ${chalk.dim('⊘')} ${entry.name} ${chalk.dim(`— ${entry.detail}`)}`);
      continue;
    }
    console.log(entry.ok
      ? `  ${chalk.green('✓')} ${entry.name}`
      : `  ${chalk.red('✗')} ${entry.name} ${chalk.dim(`— ${entry.detail}`)}`);
  }

  // Every target missed: the path exists nowhere in this brand, so the run
  // tested nothing at all. One target carrying it is enough to be a real run
  // (#814) — silently testing nothing is the outcome a green exit must never
  // mean.
  const misses = summary.filter((entry) => entry.missed);
  if (!failed && misses.length > 0 && misses.length === summary.length) {
    logger.error(noMatchMessage(rawTargets.join(' ')));
    failed = true;
  }

  if (failed) {
    process.exitCode = 1;
  }
};

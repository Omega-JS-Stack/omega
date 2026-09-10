/**
 * `omega deploy` at a brand root — D13's brand layer: fan the DELIBERATE
 * publish out over the brand's targets, each in its own framework's hands
 * (each target's own `omega deploy` verb — web sync/dispatch or direct lane,
 * backend `firebase deploy`, desktop release, extension publish; the full
 * per-target contract is docs/shared/deploys.md).
 *
 *   omega deploy                       → every target, backend first
 *   omega deploy --target=backend      → one target (target key or dir name)
 *   omega deploy --target=web,backend  → explicit set
 *   omega deploy --dry-run             → forwarded — each target prints its plan
 *
 * ORDER: the DELIVERY lane first (#678) — the same `BOOT_SERVICES` walk an
 * `omega dev` boot runs, so config, assets and certs reach the targets before
 * anything publishes them — then backend, then web, then the rest: the API
 * must be live before the site that points at it. Every flag but --target=
 * forwards verbatim to each target's framework deploy (--dry-run, --no-sync,
 * --direct, --platforms, …); targets run sequentially with streamed output. A
 * failing target STOPS the run (a broken API is no base for the site) unless
 * --continue-on-error; any failure → exit 1. A --target= token matching
 * nothing is an error, never a deploy-everything fallback — and deploys stay deliberate:
 * nothing invokes this command but the human-typed verb (D13).
 */
const path = require('node:path');
const chalk = require('chalk').default;
const attachLogFile = require('@omega.js/devkit/attach-log-file');

const { runManage } = require('../manage.js');
const { resolveBrandRoot, discoverTargets } = require('../lib/brand.js');
const { resolveTargetRun } = require('../lib/framework-bin.js');
const { runCommand } = require('../lib/run-command.js');
const { DEPLOY_ORDER, PICKER_FLAG, assertPickerFlags, selectTargets, buildForwardedFlags } = require('../lib/target-selection.js');

module.exports = async (options = {}) => {
  assertPickerFlags(options);

  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run inside a brand, or inside a target for that target\'s deploy.'));
    process.exitCode = 1;
    return;
  }

  // Tee the whole fan-out — delivery lane included — to
  // <brandRoot>/logs/deploy.log (#623): the publish verdict on disk. Only the
  // backend keeps its own dist/deploy.log; this file is the one full record.
  attachLogFile(path.join(brandRoot, 'logs', 'deploy.log'));

  const targets = discoverTargets(brandRoot).filter((entry) => entry.target || entry.custom);
  const { selected } = selectTargets({ targets, target: options[PICKER_FLAG] });

  if (selected.length === 0) {
    // Only an empty brand reaches here: a picker token that named nothing
    // already stopped the run in the selector (#780).
    console.error(chalk.red('✗ This brand has no targets under targets/ — nothing deployed.'));
    process.exitCode = 1;
    return;
  }

  const forwarded = buildForwardedFlags(options);
  const continueOnError = !!(options['continue-on-error'] || options.continueOnError);
  const dryRun = !!(options['dry-run'] || options.dryRun);

  console.log(chalk.bold(`\nOMEGA brand deploy — ${path.basename(brandRoot)} ${chalk.dim(`(${selected.map((entry) => entry.target || entry.name).join(' → ')})`)}`));

  // ─── Delivery lane, once, before the fan-out ───────────────────────────────
  // Brand inputs (config, assets, certs) reach a target through ONE step
  // (#678), and a deploy is one of its two triggers: the lane `omega dev`
  // boots is asked for BY NAME here, so the service list can only ever be
  // config.js's BOOT_SERVICES — never a second copy that drifts from it. A
  // publish must not ship inputs a manage run happened to be current on.
  console.log(chalk.cyan(`\n─── delivery lane ${chalk.dim('(brand inputs → targets)')} ───`));
  const delivery = await runManage(brandRoot, { lane: 'boot', dryRun });
  if (delivery.hasErrors) {
    console.error(chalk.red('\n✗ The delivery lane reported errors — nothing deployed (fix them above, then deploy again).'));
    process.exitCode = 1;
    return;
  }

  // ─── Execute in order, streaming each target's output ──────────────────────
  const summary = [];
  let failed = false;

  for (const [index, entry] of selected.entries()) {
    const label = `[${index + 1}/${selected.length}] ${entry.name}`;
    const run = resolveTargetRun(entry, 'deploy', forwarded, { dryRun });

    // A custom target that declares no deploy script steps aside loudly —
    // there is nothing to publish and nothing broken (#603)
    if (run.kind === 'skip') {
      console.log(chalk.dim(`\n⊘ ${label}: ${run.detail} — skipped`));
      continue;
    }

    // Its script cannot be handed --dry-run, so the dry run stops at the plan
    if (run.kind === 'plan') {
      console.log(chalk.dim(`\n⊘ ${label}: dry run — ${run.detail}`));
      continue;
    }

    if (run.kind === 'error') {
      console.log(chalk.red(`\n✗ ${label}: ${run.detail}`));
      summary.push({ name: entry.name, ok: false, detail: run.detail });
      failed = true;
      if (!continueOnError) break;
      continue;
    }

    console.log(chalk.cyan(`${`\n─── ${label} ${chalk.dim(`(${run.framework || 'custom'})`)} — ${run.label}`.trimEnd()} ───`));
    const result = await runCommand(run.command, run.args, entry.path);

    summary.push({ name: entry.name, ok: result.success, detail: result.error });
    if (!result.success) {
      failed = true;
      if (!continueOnError) {
        console.error(chalk.red(`\n✗ ${entry.name} deploy failed — stopping (later targets depend on it; --continue-on-error overrides)`));
        break;
      }
    }
  }

  // ─── Summary + aggregate exit ──────────────────────────────────────────────
  console.log(chalk.bold('\nDeploy summary'));
  for (const entry of summary) {
    console.log(entry.ok
      ? `  ${chalk.green('✓')} ${entry.name}`
      : `  ${chalk.red('✗')} ${entry.name} ${chalk.dim(`— ${entry.detail}`)}`);
  }
  const skipped = selected.length - summary.length;
  if (skipped > 0) {
    console.log(chalk.dim(`  ⊘ ${skipped} target${skipped === 1 ? '' : 's'} not attempted after the failure`));
  }

  if (failed) {
    process.exitCode = 1;
  }
};

// Re-exported for readers that came to the deploy command for them — the one
// home is lib/target-selection.js.
module.exports.selectTargets = selectTargets;
module.exports.buildForwardedFlags = buildForwardedFlags;
module.exports.DEPLOY_ORDER = DEPLOY_ORDER;

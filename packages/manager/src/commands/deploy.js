/**
 * `omega deploy` at a brand root — D13's brand layer: fan the DELIBERATE
 * publish out over the brand's targets, each in its own framework's hands
 * (each target's own `omega deploy` verb — web sync/dispatch or direct lane,
 * backend `firebase deploy`, desktop release, extension publish; the full
 * per-target contract is docs/shared/deploys.md).
 *
 *   omega deploy                       → every target, backend first
 *   omega deploy --only backend        → one target (target key or dir name)
 *   omega deploy --only web,backend    → explicit set
 *   omega deploy --except web          → everything minus
 *   omega deploy --dry-run             → forwarded — each target prints its plan
 *
 * ORDER: backend deploys FIRST, then web, then the rest — the API must be
 * live before the site that points at it. Every flag except --only/--except
 * forwards verbatim to each target's framework deploy (--dry-run, --no-sync,
 * --direct, --platforms, …); targets run sequentially with streamed output. A
 * failing target STOPS the run (a broken API is no base for the site) unless
 * --continue-on-error; any failure → exit 1. A filter matching nothing is an
 * error, never a deploy-everything fallback — and deploys stay deliberate:
 * nothing invokes this command but the human-typed verb (D13).
 */
const path = require('node:path');
const chalk = require('chalk').default;

const { resolveBrandRoot, discoverTargets } = require('../lib/brand.js');
const { resolveTargetRun } = require('../lib/framework-bin.js');
const { runCommand } = require('../lib/run-command.js');

// Deploy order — backend's API goes live before the surfaces that call it.
// A custom target (#603) has no rank, so it lands after every framework one.
const DEPLOY_ORDER = ['backend', 'web', 'extension', 'desktop', 'mobile'];

// Brand-level flags consumed HERE — everything else forwards to the targets.
// `_`/`$0` are yargs bookkeeping; continue-on-error is the manage-parity
// bail switch; only/except are the target filter.
const CONSUMED_KEYS = new Set(['_', '$0', 'only', 'except', 'continue-on-error', 'continueOnError']);

/**
 * Pure target selection — which targets deploy for a given flag set, in order.
 * Filter tokens match a target's key ('web') or its dir name ('website').
 *
 * @param {object} input
 * @param {Array<{ name: string, target: string|null }>} input.targets - the target-mapped target dirs
 * @param {string} [input.only] - comma list: exact set to deploy
 * @param {string} [input.except] - comma list: subtract from the set
 * @returns {{ selected: Array, unknown: string[] }}
 */
function selectDeployTargets({ targets, only, except }) {
  const parse = (value) => String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
  const matches = (entry, token) => entry.target === token || entry.name === token;

  const onlyTokens = parse(only);
  const exceptTokens = parse(except);
  const unknown = [...onlyTokens, ...exceptTokens].filter((token) => !targets.some((entry) => matches(entry, token)));

  const selected = targets
    .filter((entry) => (onlyTokens.length === 0 || onlyTokens.some((token) => matches(entry, token)))
      && !exceptTokens.some((token) => matches(entry, token)))
    .sort((a, b) => {
      const rank = (entry) => {
        const index = DEPLOY_ORDER.indexOf(entry.target);
        return index === -1 ? DEPLOY_ORDER.length : index;
      };
      return rank(a) - rank(b);
    });

  return { selected, unknown };
}

/**
 * Rebuild forwardable CLI flags from the yargs-parsed options: brand-level
 * keys are consumed, camelCase twins of kebab-case flags are skipped (yargs
 * mints both), booleans re-spell as --flag/--no-flag, values as --flag=value.
 */
function buildForwardedFlags(options) {
  const flags = [];

  for (const [key, value] of Object.entries(options)) {
    if (CONSUMED_KEYS.has(key)) continue;
    if (value === undefined || value === null) continue;
    // Skip yargs' camelCase duplicate when the kebab-case original exists
    if (/[A-Z]/.test(key) && key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`) in options) continue;

    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry === true) flags.push(`--${key}`);
      else if (entry === false) flags.push(`--no-${key}`);
      else flags.push(`--${key}=${entry}`);
    }
  }

  return flags;
}

module.exports = async (options = {}) => {
  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run inside a brand, or inside a target for that target\'s deploy.'));
    process.exitCode = 1;
    return;
  }

  const targets = discoverTargets(brandRoot).filter((entry) => entry.target || entry.custom);
  const { selected, unknown } = selectDeployTargets({ targets, only: options.only, except: options.except });

  for (const token of unknown) {
    console.log(chalk.yellow(`  ⚠ Unknown deploy filter "${token}" — know targets/dirs: ${targets.map((entry) => entry.target || entry.name).join(', ')}`));
  }

  if (selected.length === 0) {
    // Never fall back to deploy-everything on a bad filter — deploys publish.
    console.error(chalk.red('✗ No target matches the requested deploy set — nothing deployed.'));
    process.exitCode = 1;
    return;
  }

  const forwarded = buildForwardedFlags(options);
  const continueOnError = !!(options['continue-on-error'] || options.continueOnError);
  const dryRun = !!(options['dry-run'] || options.dryRun);

  console.log(chalk.bold(`\nOMEGA brand deploy — ${path.basename(brandRoot)} ${chalk.dim(`(${selected.map((entry) => entry.target || entry.name).join(' → ')})`)}`));

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

module.exports.selectDeployTargets = selectDeployTargets;
module.exports.buildForwardedFlags = buildForwardedFlags;
module.exports.DEPLOY_ORDER = DEPLOY_ORDER;

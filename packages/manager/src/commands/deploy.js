/**
 * `omega deploy` at a brand root — D13's brand layer: fan the DELIBERATE
 * publish out over the brand's apps, each in its own framework's hands
 * (each app's own `omega deploy` verb — web sync/dispatch or direct lane,
 * backend `firebase deploy`, desktop release, extension publish; the full
 * per-target contract is docs/shared/deploys.md).
 *
 *   omega deploy                       → every app, backend first
 *   omega deploy --only backend        → one app (target or app dir name)
 *   omega deploy --only web,backend    → explicit set
 *   omega deploy --except web          → everything minus
 *   omega deploy --dry-run             → forwarded — each app prints its plan
 *
 * ORDER: backend deploys FIRST, then web, then the rest — the API must be
 * live before the site that points at it. Every flag except --only/--except
 * forwards verbatim to each app's framework deploy (--dry-run, --no-sync,
 * --direct, --platforms, …); apps run sequentially with streamed output. A
 * failing app STOPS the run (a broken API is no base for the site) unless
 * --continue-on-error; any failure → exit 1. A filter matching nothing is an
 * error, never a deploy-everything fallback — and deploys stay deliberate:
 * nothing invokes this command but the human-typed verb (D13).
 */
const path = require('node:path');
const chalk = require('chalk').default;

const { findTarget } = require('@omega.js/devkit/omega-bin');
const { resolveBrandRoot, discoverApps } = require('../lib/brand.js');
const { resolveFrameworkBin } = require('../lib/framework-bin.js');
const { runCommand } = require('../lib/run-command.js');

// Deploy order — backend's API goes live before the surfaces that call it
const DEPLOY_ORDER = ['backend', 'web', 'extension', 'desktop', 'mobile'];

// Brand-level flags consumed HERE — everything else forwards to the apps.
// `_`/`$0` are yargs bookkeeping; continue-on-error is the manage-parity
// bail switch; only/except are the app filter.
const CONSUMED_KEYS = new Set(['_', '$0', 'only', 'except', 'continue-on-error', 'continueOnError']);

/**
 * Pure app selection — which apps deploy for a given flag set, in order.
 * Filter tokens match an app's target ('web') or its dir name ('website').
 *
 * @param {object} input
 * @param {Array<{ name: string, target: string|null }>} input.apps - target-mapped apps
 * @param {string} [input.only] - comma list: exact set to deploy
 * @param {string} [input.except] - comma list: subtract from the set
 * @returns {{ selected: Array, unknown: string[] }}
 */
function selectDeployApps({ apps, only, except }) {
  const parse = (value) => String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
  const matches = (app, token) => app.target === token || app.name === token;

  const onlyTokens = parse(only);
  const exceptTokens = parse(except);
  const unknown = [...onlyTokens, ...exceptTokens].filter((token) => !apps.some((app) => matches(app, token)));

  const selected = apps
    .filter((app) => (onlyTokens.length === 0 || onlyTokens.some((token) => matches(app, token)))
      && !exceptTokens.some((token) => matches(app, token)))
    .sort((a, b) => {
      const rank = (app) => {
        const index = DEPLOY_ORDER.indexOf(app.target);
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
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run inside a brand, or inside an app for that app\'s deploy.'));
    process.exitCode = 1;
    return;
  }

  const apps = discoverApps(brandRoot).filter((app) => app.target);
  const { selected, unknown } = selectDeployApps({ apps, only: options.only, except: options.except });

  for (const token of unknown) {
    console.log(chalk.yellow(`  ⚠ Unknown deploy filter "${token}" — know targets/dirs: ${apps.map((app) => app.target).join(', ')}`));
  }

  if (selected.length === 0) {
    // Never fall back to deploy-everything on a bad filter — deploys publish.
    console.error(chalk.red('✗ No app matches the requested deploy set — nothing deployed.'));
    process.exitCode = 1;
    return;
  }

  const forwarded = buildForwardedFlags(options);
  const continueOnError = !!(options['continue-on-error'] || options.continueOnError);

  console.log(chalk.bold(`\nOMEGA brand deploy — ${path.basename(brandRoot)} ${chalk.dim(`(${selected.map((app) => app.target).join(' → ')})`)}`));

  // ─── Execute in order, streaming each app's output ─────────────────────────
  const summary = [];
  let failed = false;

  for (const [index, app] of selected.entries()) {
    const label = `[${index + 1}/${selected.length}] ${app.name}`;
    const target = findTarget(app.path);

    if (!target || target.kind !== 'framework') {
      console.log(chalk.red(`\n✗ ${label}: no framework dependency detected (app-root package.json)`));
      summary.push({ name: app.name, ok: false, detail: 'no framework dependency detected' });
      failed = true;
      if (!continueOnError) break;
      continue;
    }

    const binPath = resolveFrameworkBin(target.dir, target.name);
    if (!binPath) {
      console.log(chalk.red(`\n✗ ${label}: ${target.name} is not installed (node_modules climb from ${target.dir} found no bin)`));
      summary.push({ name: app.name, ok: false, detail: `${target.name} is not installed` });
      failed = true;
      if (!continueOnError) break;
      continue;
    }

    console.log(chalk.cyan(`\n─── ${label} ${chalk.dim(`(${target.name})`)} — omega deploy ${forwarded.join(' ')}`.trimEnd() + ' ───'));
    const result = await runCommand(process.execPath, [binPath, 'deploy', ...forwarded], app.path);

    summary.push({ name: app.name, ok: result.success, detail: result.error });
    if (!result.success) {
      failed = true;
      if (!continueOnError) {
        console.error(chalk.red(`\n✗ ${app.name} deploy failed — stopping (later apps depend on it; --continue-on-error overrides)`));
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
    console.log(chalk.dim(`  ⊘ ${skipped} app${skipped === 1 ? '' : 's'} not attempted after the failure`));
  }

  if (failed) {
    process.exitCode = 1;
  }
};

module.exports.selectDeployApps = selectDeployApps;
module.exports.buildForwardedFlags = buildForwardedFlags;
module.exports.DEPLOY_ORDER = DEPLOY_ORDER;

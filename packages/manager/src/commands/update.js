/**
 * `omega update` at a brand root — fan the dependency-freshness verb out over
 * the brand's targets (cp251's deploy fan-out shape: same target discovery, same
 * --only/--except filter, same flag forwarding), each target reporting/applying
 * through its OWN framework's `omega update` (all of them the one devkit
 * implementation — npu-outdated semantics, 7-day release-age quarantine,
 * file: specs skipped).
 *
 *   omega update                        → every target, report only
 *   omega update --apply                → apply the safe set per target
 *   omega update --only backend        → one target (target key or dir name)
 *   omega update --apply --major       → include breaking jumps
 *
 * Unlike deploy, targets are INDEPENDENT here — a failing target never blocks the
 * rest (no --continue-on-error needed); any failure still exits 1.
 */
const path = require('node:path');
const chalk = require('chalk').default;

const { findTarget } = require('@omega.js/devkit/omega-bin');
const { resolveBrandRoot, discoverTargets } = require('../lib/brand.js');
const { resolveFrameworkBin } = require('../lib/framework-bin.js');
const { runCommand } = require('../lib/run-command.js');
const { selectDeployTargets, buildForwardedFlags } = require('./deploy.js');

module.exports = async (options = {}) => {
  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run inside a brand, or inside a target for that target\'s update.'));
    process.exitCode = 1;
    return;
  }

  const targets = discoverTargets(brandRoot).filter((entry) => entry.target);
  const { selected, unknown } = selectDeployTargets({ targets, only: options.only, except: options.except });

  for (const token of unknown) {
    console.log(chalk.yellow(`  ⚠ Unknown update filter "${token}" — known targets/dirs: ${targets.map((entry) => entry.target).join(', ')}`));
  }

  if (selected.length === 0) {
    console.error(chalk.red('✗ No target matches the requested update set — nothing checked.'));
    process.exitCode = 1;
    return;
  }

  const forwarded = buildForwardedFlags(options);

  console.log(chalk.bold(`\nOMEGA brand update — ${path.basename(brandRoot)} ${chalk.dim(`(${selected.map((entry) => entry.target).join(', ')})`)}`));

  // ─── Fan out, streaming each target's report — targets are independent ─────
  const summary = [];

  for (const [index, entry] of selected.entries()) {
    const label = `[${index + 1}/${selected.length}] ${entry.name}`;
    const target = findTarget(entry.path);

    if (!target || target.kind !== 'framework') {
      console.log(chalk.red(`\n✗ ${label}: no framework dependency detected (target-root package.json)`));
      summary.push({ name: entry.name, ok: false, detail: 'no framework dependency detected' });
      continue;
    }

    const binPath = resolveFrameworkBin(target.dir, target.name);
    if (!binPath) {
      console.log(chalk.red(`\n✗ ${label}: ${target.name} is not installed (node_modules climb from ${target.dir} found no bin)`));
      summary.push({ name: entry.name, ok: false, detail: `${target.name} is not installed` });
      continue;
    }

    console.log(chalk.cyan(`\n─── ${label} ${chalk.dim(`(${target.name})`)} — omega update ${forwarded.join(' ')}`.trimEnd() + ' ───'));
    const result = await runCommand(process.execPath, [binPath, 'update', ...forwarded], entry.path);
    summary.push({ name: entry.name, ok: result.success, detail: result.error });
  }

  // ─── Summary + aggregate exit ──────────────────────────────────────────────
  console.log(chalk.bold('\nUpdate summary'));
  for (const entry of summary) {
    console.log(entry.ok
      ? `  ${chalk.green('✓')} ${entry.name}`
      : `  ${chalk.red('✗')} ${entry.name} ${chalk.dim(`— ${entry.detail}`)}`);
  }

  if (summary.some((entry) => !entry.ok)) {
    process.exitCode = 1;
  }
};

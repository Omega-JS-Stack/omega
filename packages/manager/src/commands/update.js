/**
 * `omega update` at a brand root — fan the dependency-freshness verb out over
 * the brand's targets (cp251's deploy fan-out shape: same target discovery, same
 * --target= picker, same flag forwarding), each target reporting/applying
 * through its OWN framework's `omega update` (all of them the one devkit
 * implementation — npu-outdated semantics, 7-day release-age quarantine,
 * file: specs skipped).
 *
 *   omega update                        → every target, report only
 *   omega update --apply                → apply the safe set per target
 *   omega update --target=backend       → one target (target key or dir name)
 *   omega update --apply --major       → include breaking jumps
 *
 * Unlike deploy, targets are INDEPENDENT here — a failing target never blocks the
 * rest (no --continue-on-error needed); any failure still exits 1.
 *
 * The BRAND ROOT is the last leg of an unpicked run (#794): its shell manifest
 * holds exactly one thing of ours, the `@omega.js/manager` pin, and without it
 * a manager-behind brand could never self-heal — the lockstep gate would refuse
 * every verb and the fix it names would move every target except the one that
 * was wrong. That leg runs the same devkit implementation in-process (there is
 * no framework bin to spawn at the root: it would dispatch straight back here)
 * and is scoped to that one package by name, so a brand's own root tooling is
 * never touched. `--target=` names TARGETS, so a picked run skips the root.
 */
const path = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const attachLogFile = require('@omega.js/devkit/attach-log-file');

const { findTarget } = require('@omega.js/devkit/omega-bin');
// The module object, not the function: the root leg is the one caller that
// runs devkit's update in-process, and its test replaces this export.
const devkitUpdate = require('@omega.js/devkit/update');
const { resolveBrandRoot, discoverTargets } = require('../lib/brand.js');
const { resolveFrameworkBin } = require('../lib/framework-bin.js');
const { runCommand } = require('../lib/run-command.js');
const { PICKER_FLAG, assertPickerFlags, selectTargets, buildForwardedFlags } = require('../lib/target-selection.js');

// The one @omega.js dependency a brand-root shell manifest carries
const ROOT_PACKAGE = '@omega.js/manager';

module.exports = async (options = {}) => {
  assertPickerFlags(options);

  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run inside a brand, or inside a target for that target\'s update.'));
    process.exitCode = 1;
    return;
  }

  // Tee the whole fan-out to <brandRoot>/logs/update.log (#623) — which target
  // was checked, what it reported, what applied.
  attachLogFile(path.join(brandRoot, 'logs', 'update.log'));

  const targets = discoverTargets(brandRoot).filter((entry) => entry.target);
  const { selected } = selectTargets({ targets, target: options[PICKER_FLAG] });

  if (selected.length === 0) {
    console.error(chalk.red('✗ This brand has no targets under targets/ — nothing checked.'));
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

    console.log(chalk.cyan(`${`\n─── ${label} ${chalk.dim(`(${target.name})`)} — omega update ${forwarded.join(' ')}`.trimEnd()} ───`));
    const result = await runCommand(process.execPath, [binPath, 'update', ...forwarded], entry.path);
    summary.push({ name: entry.name, ok: result.success, detail: result.error });
  }

  // ─── The brand root: its @omega.js/manager pin, and nothing else ───────────
  const rootManifest = jetpack.read(path.join(brandRoot, 'package.json'), 'json') || {};
  const rootSpec = rootManifest.dependencies?.[ROOT_PACKAGE] || rootManifest.devDependencies?.[ROOT_PACKAGE];

  if (!options[PICKER_FLAG] && rootSpec) {
    console.log(chalk.cyan(`${`\n─── [root] brand root ${chalk.dim(`(${ROOT_PACKAGE})`)} — omega update ${forwarded.join(' ')}`.trimEnd()} ───`));
    try {
      await devkitUpdate.runUpdate({
        dir: brandRoot,
        only: [ROOT_PACKAGE],
        apply: options.apply,
        major: options.major,
        minAge: options.minAge ?? options['min-age'],
        forceFresh: options.forceFresh || options['force-fresh'],
      });
      summary.push({ name: 'brand root', ok: true });
    } catch (error) {
      console.log(chalk.red(`✗ brand root: ${error.message}`));
      summary.push({ name: 'brand root', ok: false, detail: error.message });
    }
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

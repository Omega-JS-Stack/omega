/**
 * The brand-root VERB fan-out — one target-independent verb run over every
 * target the brand has, framework and custom alike (#603).
 *
 * `omega build` and `omega clean` are the two verbs a brand root had for no
 * target type at all: start, test and deploy each fanned out already, so a
 * brand could compile or wipe its targets only one `cd` at a time. Both are the
 * SAME walk with a different word, so they share this one implementation —
 * commands/build.js and commands/clean.js are its two callers.
 *
 * The shape is the deploy fan-out's, deliberately: the same target discovery,
 * the same `--target=` picker and the same dependency ORDER
 * (selectTargets — backend first, custom targets last), the same flag
 * forwarding, and `resolveTargetRun` as the one place a verb becomes a command
 * (a framework's own `omega <verb>`, or the target's `npm run <verb>`).
 *
 * What differs from deploy: targets are INDEPENDENT here. Neither verb
 * publishes anything, so a failure never stops the walk — knowing every broken
 * target after one run beats discovering them one build at a time — and any
 * failure still exits 1. A target that declares no such script steps aside
 * LOUDLY, naming the target and the verb, and is never counted a failure. And
 * --dry-run is CONSUMED here rather than forwarded: no framework's build/clean
 * honors it, so every target prints the command it would have run and the walk
 * executes nothing.
 *
 * The brand-root log tee lives HERE, not in the two verb files (#623): every
 * other fan-out attaches at the top of its own command, but build and clean
 * share this one walk and this is the only place that knows the brand root, so
 * one attach keyed by the verb serves both — logs/build.log and logs/clean.log.
 */
const path = require('node:path');
const chalk = require('chalk').default;
const attachLogFile = require('@omega.js/devkit/attach-log-file');

const { resolveBrandRoot, discoverTargets } = require('./brand.js');
const { resolveTargetRun } = require('./framework-bin.js');
const { runCommand } = require('./run-command.js');
const { PICKER_FLAG, assertPickerFlags, selectTargets, buildForwardedFlags } = require('./target-selection.js');

// Both yargs spellings of the flag this fan-out consumes (see the header)
const DRY_RUN_KEYS = ['dry-run', 'dryRun'];

/**
 * Run one verb across the brand's targets.
 *
 * @param {string} verb - The verb ('build' | 'clean').
 * @param {object} [options] - The parsed CLI options (--target= consumed, the rest forwarded).
 * @param {object} [deps] - Test seam: { run } replaces runCommand.
 * @returns {Promise<void>} - Failures land on process.exitCode; only a retired
 *                            picker (#780) throws, and it throws before any work.
 */
async function runVerbFanout(verb, options = {}, deps = {}) {
  assertPickerFlags(options);

  const run = deps.run || runCommand;

  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red(`✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run inside a brand, or inside a target for that target's ${verb}.`));
    process.exitCode = 1;
    return;
  }

  // Tee the whole fan-out to <brandRoot>/logs/<verb>.log (#623) — the walk's
  // OWN verdict on disk (a target's output rides its own log: runCommand
  // inherits the terminal, so a child never passes through these writers).
  attachLogFile(path.join(brandRoot, 'logs', `${verb}.log`));

  const targets = discoverTargets(brandRoot).filter((entry) => entry.target || entry.custom);
  const { selected } = selectTargets({ targets, target: options[PICKER_FLAG] });

  if (selected.length === 0) {
    console.error(chalk.red(`✗ This brand has no targets under targets/ — nothing ${verb === 'clean' ? 'cleaned' : 'built'}.`));
    process.exitCode = 1;
    return;
  }

  const forwarded = buildForwardedFlags(options, DRY_RUN_KEYS);
  const dryRun = !!(options['dry-run'] || options.dryRun);

  console.log(chalk.bold(`\nOMEGA brand ${verb} — ${path.basename(brandRoot)}${dryRun ? chalk.dim(' (dry run)') : ''} ${chalk.dim(`(${selected.map((entry) => entry.target || entry.name).join(' → ')})`)}`));

  const summary = [];

  for (const [index, entry] of selected.entries()) {
    const label = `[${index + 1}/${selected.length}] ${entry.name}`;
    const resolved = resolveTargetRun(entry, verb, forwarded, { dryRun });

    // A target that declares no such script has nothing to do and nothing
    // broken — the skip NAMES the target and the verb, because a verb that
    // quietly did nothing is indistinguishable from one that worked (#603)
    if (resolved.kind === 'skip') {
      console.log(chalk.dim(`\n⊘ ${label}: ${resolved.detail} — skipped`));
      continue;
    }

    // Under --dry-run the run IS the plan line — nothing executes on either
    // lane, and a target that would have been skipped still says so above
    if (resolved.kind === 'plan') {
      console.log(chalk.dim(`\n⊘ ${label}: dry run — ${resolved.detail}`));
      continue;
    }

    if (resolved.kind === 'error') {
      console.log(chalk.red(`\n✗ ${label}: ${resolved.detail}`));
      summary.push({ name: entry.name, ok: false, detail: resolved.detail });
      continue;
    }

    console.log(chalk.cyan(`${`\n─── ${label} ${chalk.dim(`(${resolved.framework || 'custom'})`)} — ${resolved.label}`.trimEnd()} ───`));
    const result = await run(resolved.command, resolved.args, entry.path);

    summary.push({ name: entry.name, ok: result.success, detail: result.error });
  }

  console.log(chalk.bold(`\n${verb.charAt(0).toUpperCase()}${verb.slice(1)} summary`));
  for (const entry of summary) {
    console.log(entry.ok
      ? `  ${chalk.green('✓')} ${entry.name}`
      : `  ${chalk.red('✗')} ${entry.name} ${chalk.dim(`— ${entry.detail}`)}`);
  }

  if (summary.some((entry) => !entry.ok)) {
    process.exitCode = 1;
  }
}

module.exports = { runVerbFanout };

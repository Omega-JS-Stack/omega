/**
 * The brand root's pass-through: a framework verb the manager keeps no command
 * for runs on the targets `--target=` picks, each through its own framework's
 * bin (`resolveTargetRun`), in the verb table's TARGET_ORDER. The verb's row
 * decides the selection: `fanout: 'each'` with no picker runs every target whose
 * framework owns the verb, `fanout: 'none'` runs exactly one picked target, and a
 * picked target whose framework does not own the verb is refused by name. The
 * args after the verb forward verbatim, scope words included.
 */
const path = require('node:path');
const chalk = require('chalk').default;

const { findTarget } = require('@omega.js/devkit/omega-bin');
const { findVerb } = require('@omega.js/devkit/verbs');
const { PICKER_FLAG, takePicker } = require('@omega.js/devkit/target-picker');
const { resolveBrandRoot, discoverTargets } = require('./brand.js');
const { selectTargets } = require('./target-selection.js');
const { walkTargets } = require('./verb-fanout.js');

const MANAGER = '@omega.js/manager';

/** Throw a refusal: the cli-router prints its message alone and exits 1. */
function refuse(message) {
  const error = new Error(`omega: ${message}`);
  error.refusal = true;
  throw error;
}

/**
 * The row the pass-through runs for a token, or null when it carries no such
 * verb: an unknown token, a `root` row (the manager's own commands), or a row
 * no framework owns.
 *
 * @param {string} token - The verb as typed.
 * @returns {object|null} The VERBS row.
 */
function passThroughRow(token) {
  const row = findVerb(token);
  if (!row || row.fanout === 'root') return null;
  return row.owners.some((owner) => owner !== MANAGER) ? row : null;
}

/** The framework a discovered target declares, or null for a custom target. */
function frameworkOf(entry) {
  const found = entry.custom ? null : findTarget(entry.path);
  return found && found.kind === 'framework' ? found.name : null;
}

/**
 * Run a framework verb from the brand root on the targets it selects.
 *
 * @param {string} token - The verb as typed (a name or an alias), one passThroughRow answers.
 * @param {string[]} argv - The raw args after the bin, the verb included.
 * @param {object} [deps] - Test seam: { run } replaces runCommand.
 * @returns {Promise<void>} - Failures land on process.exitCode; a refusal throws before anything runs.
 */
async function runPassThrough(token, argv, deps = {}) {
  const row = passThroughRow(token);
  const owners = row.owners.filter((owner) => owner !== MANAGER).join(', ');

  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) refuse(`"${token}" runs at a brand root (no config/omega.json5 up the tree from ${process.cwd()}). Nothing ran.`);

  const { tokens, rest } = takePicker(argv);
  const forwarded = rest.filter((_, index) => index !== rest.indexOf(token));

  const targets = discoverTargets(brandRoot).filter((entry) => entry.target || entry.custom);
  const { selected: picked } = selectTargets({ targets, target: tokens.join(',') });
  const owns = (entry) => row.owners.includes(frameworkOf(entry));

  // A single-target verb never guesses which target: the picker names it
  if (row.fanout === 'none' && tokens.length !== 1) {
    const owning = targets.filter(owns).map((entry) => entry.name);
    refuse(`"${token}" runs on one target: npx omega ${token} --${PICKER_FLAG}=<name>, the name one of ${owning.join(', ') || `nothing here (it is ${owners}'s verb)`}. Nothing ran.`);
  }

  const refused = tokens.length > 0 ? picked.filter((entry) => !owns(entry)) : [];
  if (refused.length > 0) {
    const named = refused.map((entry) => `${entry.name} (${frameworkOf(entry) || 'custom'})`).join(', ');
    refuse(`"${token}" is ${owners}'s verb, and ${named} cannot run it. Nothing ran.`);
  }

  const selected = picked.filter(owns);
  if (selected.length === 0) refuse(`no target in this brand runs "${token}" (it is ${owners}'s verb). Nothing ran.`);

  console.log(chalk.bold(`\nOMEGA brand ${token}: ${path.basename(brandRoot)} ${chalk.dim(`(${selected.map((entry) => entry.name).join(' → ')})`)}`));
  await walkTargets({ verb: token, selected, forwarded, run: deps.run });
}

module.exports = { passThroughRow, runPassThrough };

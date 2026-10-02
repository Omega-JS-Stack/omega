/**
 * Ensure the brand's Claude settings name the right copy of the omega plugin:
 * the committed `.claude/settings.json` the published copy, the private
 * `.claude/settings.local.json` the local copy while the brand is linked.
 * Then the machine: one line when the published copy is not installed, and
 * the two update commands when it is older than this OMEGA.
 */
const chalk = require('chalk').default;

const { ensureClaudeSettings, SETTINGS_FILE, LOCAL_SETTINGS_FILE, PLUGIN_ID, LOCAL_PLUGIN_ID } = require('../../../lib/claude-settings.js');
const { INSTALL_HINT, runClaude, machinePluginState, ensureMachinePlugin } = require('../../../lib/claude-machine.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

const FAMILY_VERSION = require('../../../../package.json').version;

const COMMITTED_LABELS = {
  present: `${SETTINGS_FILE} enables the published omega plugin (${PLUGIN_ID})`,
  created: `Created ${SETTINGS_FILE}: the published omega plugin loads in every session here`,
  healed: `Healed ${SETTINGS_FILE}: the published omega plugin (your other settings kept)`,
};
const LOCAL_LABELS = {
  present: `${LOCAL_SETTINGS_FILE} enables the local omega plugin (${LOCAL_PLUGIN_ID}): this brand is linked`,
  written: `Wrote ${LOCAL_SETTINGS_FILE}: the local omega plugin loads here while the brand is linked`,
  removed: `Took the local omega plugin out of ${LOCAL_SETTINGS_FILE}: this brand is live`,
};
const PLANS = {
  created: `create ${SETTINGS_FILE} to enable the published omega plugin (${PLUGIN_ID})`,
  healed: `heal ${SETTINGS_FILE} to enable the published omega plugin (${PLUGIN_ID})`,
  written: `write ${LOCAL_SETTINGS_FILE} to enable the local omega plugin (${LOCAL_PLUGIN_ID})`,
  removed: `take the local omega plugin out of ${LOCAL_SETTINGS_FILE}`,
};

/**
 * The published copy on this machine: a hint while it is not installed, an
 * update while it is behind. A failing `claude` is the machine's, never the
 * brand's, so it warns and the walk goes on.
 *
 * @param {Function} exec - The `claude` runner
 */
function ensureMachine(exec) {
  try {
    const state = machinePluginState({ exec });
    if (!state.claude) {
      return null;
    }
    if (!state.version) {
      console.log(`      ${chalk.yellow('⚠')} ${INSTALL_HINT}`);
      return 'not-installed';
    }
    const { actions } = ensureMachinePlugin({ exec, familyVersion: FAMILY_VERSION });
    if (actions.length > 0) {
      console.log(`      ${chalk.green('✓')} Claude plugin on this machine: ${actions.join(', ')} (${PLUGIN_ID}, OMEGA ${FAMILY_VERSION})`);
    }
    return actions.length > 0 ? actions.join(',') : null;
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Could not check the Claude plugin on this machine: ${error.message.split('\n')[0]}`);
    return 'failed';
  }
}

// Tests inject `claudeExec` so the real machine is never touched.
module.exports = async ({ brandRoot, options = {}, claudeExec = runClaude }) => {
  const result = ensureClaudeSettings(brandRoot, { dryRun: options.dryRun });

  const invalid = [
    result.committed === 'invalid' && SETTINGS_FILE,
    result.local === 'invalid' && LOCAL_SETTINGS_FILE,
  ].filter(Boolean);
  for (const file of invalid) {
    console.log(`      ${chalk.yellow('⚠')} ${file} is not valid JSON: fix it so the omega plugin can be set there`);
  }

  if (options.dryRun) {
    const plans = [PLANS[result.committed], PLANS[result.local]].filter(Boolean);
    plans.forEach((plan) => dryRunPlan(plan));
    if (invalid.length > 0) {
      return { status: 'warned', reason: `${invalid.join(', ')} not valid JSON`, output: { claudeSettings: result } };
    }
    return plans.length > 0 ? { output: { claudeSettings: 'planned' } } : null;
  }

  for (const label of [COMMITTED_LABELS[result.committed], LOCAL_LABELS[result.local]].filter(Boolean)) {
    console.log(`      ${chalk.green('✓')} ${label}`);
  }

  const machine = ensureMachine(claudeExec);
  const changed = result.committed !== 'present' || !['present', 'absent'].includes(result.local) || machine !== null;
  const output = changed ? { output: { claudeSettings: { ...result, ...(machine ? { machine } : {}) } } } : null;
  if (invalid.length > 0) {
    return { status: 'warned', reason: `${invalid.join(', ')} not valid JSON`, ...output };
  }
  return output;
};

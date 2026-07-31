/**
 * Ensure the brand's committed `.claude/settings.json` registers the omega
 * marketplace from the installed manager package and enables the plugin
 * ([#62](https://github.com/Omega-JS-Stack/omega/issues/62)) — the consumer
 * half of the plugin install. Only a PUBLISHED install carries the vendored
 * marketplace; the local era skips (the developer's user-scope install serves
 * those sessions). Consumer settings are never clobbered.
 */
const chalk = require('chalk').default;

const { ensureClaudeSettings, SETTINGS_FILE, PLUGIN_ID } = require('../../../lib/claude-settings.js');

module.exports = async ({ brandRoot }) => {
  const result = ensureClaudeSettings(brandRoot);

  if (result === 'skipped') {
    console.log(`      ${chalk.green('✓')} No vendored omega plugin in node_modules/@omega.js/manager (local era) — ${SETTINGS_FILE} left alone`);
    return null;
  }

  if (result === 'invalid') {
    console.log(`      ${chalk.yellow('⚠')} ${SETTINGS_FILE} is not valid JSON — fix it so the omega plugin (${PLUGIN_ID}) can be registered`);
    return { status: 'warned', output: { claudeSettings: result } };
  }

  const label = {
    present: `${SETTINGS_FILE} enables the omega plugin (${PLUGIN_ID})`,
    created: `Created ${SETTINGS_FILE} — the omega plugin loads in every session here`,
    healed: `Healed ${SETTINGS_FILE} — omega plugin registered (your other settings preserved)`,
  }[result];
  console.log(`      ${chalk.green('✓')} ${label}`);

  return result === 'present' ? null : { output: { claudeSettings: result } };
};

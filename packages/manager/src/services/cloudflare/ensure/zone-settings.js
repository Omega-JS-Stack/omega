/**
 * Ensure zone settings match `cloudflare.settings`.
 *
 * 1. Reads all settings in one bulk call + any addon settings individually.
 * 2. Diffs against desired settings — skips read-only and absent ones.
 * 3. Patches each changed setting (one API call per setting — Cloudflare has no bulk PATCH).
 *
 * Failures on individual settings don't block the rest.
 */
const chalk = require('chalk').default;
const { DEFAULTS } = require('../../../config.js');
const { cacheRead } = require('../lib/read-cache.js');
const { getZoneId, zoneGate } = require('../lib/ruleset-helper.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

// Settings not returned by /zones/{id}/settings — each needs its own GET.
const ADDON_SETTINGS = ['speed_brain', 'fonts'];

module.exports = async function ensureZoneSettings(context) {
  const { cloudflareApi: api, brandRoot, brandConfig, options = {} } = context;
  const zoneId = getZoneId(context);
  const gated = zoneGate(context, 'zoneSettings');
  if (gated) return gated;

  // === READ ===
  const bulkResponse = await api.makeRequest(`/zones/${zoneId}/settings`);
  const settings = {};
  for (const s of bulkResponse.result) {
    settings[s.id] = { value: s.value, editable: s.editable !== false };
  }

  const targetAddons = ADDON_SETTINGS.filter((id) => Object.keys(DEFAULTS.cloudflare.settings).includes(id));
  for (const id of targetAddons) {
    if (settings[id]) continue;
    try {
      const response = await api.makeRequest(`/zones/${zoneId}/settings/${id}`);
      settings[id] = { value: response.result.value, editable: response.result.editable !== false };
    } catch (error) {
      console.log(`      ${chalk.yellow('⚠')} addon setting ${chalk.bold(id)} not available${chalk.dim(`: ${error.message}`)}`);
    }
  }

  console.log(`      ${chalk.green('✓')} Read ${chalk.dim(`(${Object.keys(settings).length} items)`)}`);
  cacheRead(brandRoot, 'zone-settings', { count: Object.keys(settings).length, settings });

  // === DIFF ===
  const desired = brandConfig?.cloudflare?.settings;
  if (!desired || typeof desired !== 'object') {
    return;
  }

  const updates = {};
  const skipped = [];

  for (const [key, desiredValue] of Object.entries(desired)) {
    const current = settings[key];
    if (!current) continue; // not on this plan
    if (!current.editable) {
      skipped.push(key);
      continue;
    }

    const isObject = typeof desiredValue === 'object' && desiredValue !== null;
    const changed = isObject
      ? JSON.stringify(current.value) !== JSON.stringify(desiredValue)
      : current.value !== desiredValue;
    if (!changed) continue;

    updates[key] = desiredValue;
    const currentDisplay = isObject ? '(object)' : String(current.value);
    const desiredDisplay = isObject ? '(object)' : String(desiredValue);
    console.log(`      ${chalk.dim('·')} ${key}: ${chalk.dim(currentDisplay)} => ${chalk.cyan(desiredDisplay)}`);
  }

  if (skipped.length > 0) {
    console.log(`      ${chalk.yellow('⚠')} ${skipped.length} read-only setting(s) skipped: ${chalk.dim(skipped.join(', '))}`);
  }

  if (Object.keys(updates).length === 0) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  if (options.dryRun) {
    return dryRunPlan(`patch ${Object.keys(updates).length} setting(s)`, { status: 'success', output: { settings: { planned: Object.keys(updates) } } });
  }

  // === WRITE ===
  const output = { updated: true, success: [], failed: [] };

  for (const [key, value] of Object.entries(updates)) {
    try {
      await api.makeRequest(`/zones/${zoneId}/settings/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
      });
      output.success.push(key);
      const display = typeof value === 'object' ? '(object)' : String(value);
      console.log(`      ${chalk.green('✓')} ${key} => ${chalk.cyan(display)}`);
    } catch (error) {
      output.failed.push({ key, error: error.message });
      console.error(`      ${chalk.red('✗')} ${key}${chalk.dim(`: ${error.message}`)}`);
    }
  }

  output.count = output.success.length;
  return { output: { settings: output } };
};

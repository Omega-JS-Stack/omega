/**
 * Ensure a Cloudflare Speed Test schedule for the brand homepage matches
 * `edge.providers.cloudflare.speedTest`.
 *
 * 1. Reads all currently-tested pages + their schedules.
 * 2. Locates the homepage schedule (compared loosely — Cloudflare returns mixed URL formats).
 * 3. POSTs the schedule (create-or-replace endpoint).
 */
const chalk = require('chalk').default;
const { cacheRead } = require('../lib/read-cache.js');
const { getZoneId, zoneGate } = require('../lib/ruleset-helper.js');
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensureSpeedScheduledTests(context) {
  const { cloudflareApi: api, brandRoot, brandConfig, domain, options = {} } = context;
  const zoneId = getZoneId(context);
  const gated = zoneGate(context, 'speedScheduledTests');
  if (gated) return gated;

  // === READ ===
  // The Speed API rejects zones that aren't active yet (nameservers pending)
  // with 401 speed.errors.zone_not_active — skip until the zone activates
  let pagesData;
  try {
    pagesData = await api.makeRequest(`/zones/${zoneId}/speed_api/pages`);
  } catch (error) {
    if (error.message.includes('zone_not_active')) {
      console.log(`      ${chalk.dim('⊘ Zone not active yet (nameservers pending) — skipping until activation')}`);
      return { status: 'skipped' };
    }
    throw error;
  }
  const pages = pagesData.result || [];

  const schedules = [];
  for (const page of pages) {
    try {
      const scheduleData = await api.makeRequest(`/zones/${zoneId}/speed_api/schedule/${encodeURIComponent(page.url)}`);
      if (scheduleData.result) {
        schedules.push({ url: page.url, schedule: scheduleData.result });
      }
    } catch (error) {
      if (!error.message.includes('404')) {
        console.warn(`      ${chalk.yellow('⚠')} Failed to get schedule for ${chalk.cyan(page.url)}${chalk.dim(`: ${error.message}`)}`);
      }
    }
  }

  console.log(`      ${chalk.green('✓')} Read`);
  cacheRead(brandRoot, 'speed-scheduled-tests', { schedules });

  // === DIFF ===
  const speedTestConfig = brandConfig?.edge?.providers?.cloudflare?.speedTest;
  if (!speedTestConfig) {
    console.log(`      ${chalk.dim('⊘ No changes needed')}`);
    return;
  }

  const homepageUrl = `https://${domain}`;
  const normalizeUrl = (url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const normalizedHomepage = normalizeUrl(homepageUrl);
  const existingSchedule = schedules.find((s) => normalizeUrl(s.url) === normalizedHomepage);

  const targetFrequency = speedTestConfig.frequency;
  const targetRegion = speedTestConfig.region;

  if (existingSchedule) {
    const current = existingSchedule.schedule;
    if (current.frequency === targetFrequency && current.region === targetRegion) {
      console.log(`      ${chalk.dim('⊘ No changes needed')}`);
      return;
    }
    console.log(`      ${chalk.dim('·')} update ${chalk.cyan(homepageUrl)}: ${chalk.dim(`${current.frequency}/${current.region}`)} => ${chalk.cyan(`${targetFrequency}/${targetRegion}`)}`);
  } else {
    console.log(`      ${chalk.dim('·')} create ${chalk.cyan(homepageUrl)}: ${chalk.cyan(`${targetFrequency} in ${targetRegion}`)}`);
  }

  if (options.dryRun) {
    return dryRunPlan(`${existingSchedule ? 'update' : 'create'} the speed test schedule`, { status: 'success', output: { speedTest: { planned: existingSchedule ? 'update' : 'create' } } });
  }

  // === WRITE ===
  const output = { updated: false };
  const action = existingSchedule ? 'updated' : 'created';
  try {
    await api.makeRequest(`/zones/${zoneId}/speed_api/schedule/${encodeURIComponent(homepageUrl)}`, {
      method: 'POST',
      body: JSON.stringify({ frequency: targetFrequency, region: targetRegion }),
    });
    output.updated = true;
    console.log(`      ${chalk.green('✓')} Speed Test Schedule ${action}: ${chalk.cyan(homepageUrl)} (${chalk.cyan(`${targetFrequency}, ${targetRegion}`)})`);
  } catch (error) {
    output.error = error.message;
    console.error(`      ${chalk.red('✗')} Speed Test Schedule failed for ${chalk.cyan(homepageUrl)}${chalk.dim(`: ${error.message}`)}`);
  }

  return { output: { speedTest: output } };
};

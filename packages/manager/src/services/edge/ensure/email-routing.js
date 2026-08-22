/**
 * Ensure Cloudflare Email Routing is enabled and forwarding rules are synced.
 *
 * Only runs when domain.email.providers names cloudflare; rules come from
 * domain.email.forwarding [{ from: 'support' | '*', to: 'inbox@…' }].
 *
 * Unverified destination addresses: a verification email is sent; interactive
 * runs open the dashboard and retry the rule write until the address verifies,
 * non-interactive/dry runs return warned with the dashboard URL — rerun after
 * verifying.
 */
const chalk = require('chalk').default;
const { openBrowserAndPoll } = require('@omega.js/devkit/flows');
const { cacheRead } = require('../lib/read-cache.js');
const { getZoneId, zoneGate } = require('../lib/ruleset-helper.js');
const { resolveEmailProvider } = require('../../domain/lib/registrars.js');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');

function isUnverifiedError(error) {
  return error.message.includes('2054') || error.message.toLowerCase().includes('not verified');
}

async function getAccountId(api, zoneId) {
  const zone = await api.makeRequest(`/zones/${zoneId}`);
  return zone.result.account.id;
}

/**
 * Send a verification email for the destination; interactive runs then open
 * the dashboard and retry the rule write until the address verifies.
 *
 * @returns {boolean} - true when the rule landed after verification
 */
async function handleUnverified(api, zoneId, destination, retryWrite, options = {}) {
  console.log(`      ${chalk.yellow('⚠')} Destination ${chalk.cyan(destination)} is not verified in Cloudflare`);

  const accountId = await getAccountId(api, zoneId);
  try {
    await api.makeRequest(`/accounts/${accountId}/email/routing/addresses`, {
      method: 'POST',
      body: JSON.stringify({ email: destination }),
    });
    console.log(`      ${chalk.dim('→')} Verification email sent to ${chalk.cyan(destination)}`);
  } catch (verifyError) {
    if (verifyError.message.includes('already exists')) {
      console.log(`      ${chalk.dim('→')} Verification already pending for ${chalk.cyan(destination)}`);
    } else {
      console.log(`      ${chalk.yellow('⚠')} Could not send verification email${chalk.dim(`: ${verifyError.message}`)}`);
    }
  }

  const dashboardUrl = `https://dash.cloudflare.com/${accountId}/email-routing/destination-addresses`;

  if (canPrompt(options)) {
    const result = await openBrowserAndPoll({
      url: dashboardUrl,
      label: 'the Cloudflare destination-addresses page',
      promptMessage: `Verify ${chalk.cyan(destination)} in Cloudflare Email Routing (check the inbox).`,
      waitMessage: 'Checking verification',
      indent: '      ',
      check: async () => {
        try {
          await retryWrite();
          return { done: true };
        } catch (error) {
          if (isUnverifiedError(error)) {
            return { done: false };
          }
          return { done: true, error: error.message };
        }
      },
    });

    if (result.success) {
      console.log(`      ${chalk.green('✓')} Verified — rule created`);
      return true;
    }
    if (result.error) {
      console.log(`      ${chalk.yellow('⚠')} Rule write failed${chalk.dim(`: ${result.error}`)}`);
    }
  }

  console.log(`      ${chalk.dim(`Verify at: ${dashboardUrl} — then rerun`)}`);
  return false;
}

module.exports = async function ensureEmailRouting(context) {
  const { cloudflareApi: api, brandRoot, domain, brandConfig, options = {} } = context;
  const zoneId = getZoneId(context);
  const gated = zoneGate(context, 'emailRouting');
  if (gated) return gated;
  const emailConfig = brandConfig.domain?.email;

  if (resolveEmailProvider(brandConfig) !== 'cloudflare') {
    console.log(`      ${chalk.dim('⊘ Email provider is not cloudflare — nothing to route')}`);
    return;
  }

  // === READ: routing status ===
  let routing = null;
  try {
    const resp = await api.makeRequest(`/zones/${zoneId}/email/routing`);
    routing = resp.result;
  } catch {
    if (options.dryRun) {
      return dryRunPlan('enable email routing', { status: 'success', output: { emailRouting: { planned: 'enable' } } });
    }
    console.log(`      ${chalk.dim('→')} Enabling email routing...`);
    await api.makeRequest(`/zones/${zoneId}/email/routing/enable`, { method: 'POST' });
    const resp = await api.makeRequest(`/zones/${zoneId}/email/routing`);
    routing = resp.result;
  }

  if (routing?.enabled) {
    console.log(`      ${chalk.green('✓')} Email routing enabled`);
  } else {
    console.log(`      ${chalk.yellow('⚠')} Email routing not yet active (may need DNS propagation)`);
  }

  const desiredRules = emailConfig.forwarding || [];
  if (desiredRules.length === 0) {
    console.log(`      ${chalk.dim('→')} No forwarding rules configured`);
    return { output: { emailRouting: { enabled: true, rules: 0 } } };
  }

  // Split catch-all from regular rules — Cloudflare uses a separate endpoint for catch-all
  const desiredCatchAll = desiredRules.find((r) => r.from === '*');
  const desiredRegular = desiredRules.filter((r) => r.from !== '*');

  const existingResp = await api.makeRequest(`/zones/${zoneId}/email/routing/rules`);
  const existingRules = existingResp.result || [];
  cacheRead(brandRoot, 'email-routing', { routing, rules: existingRules });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let deleted = 0;
  let unverified = 0;
  let planned = 0;

  // --- Catch-all rule (separate API endpoint) ---
  if (desiredCatchAll) {
    const catchAllResp = await api.makeRequest(`/zones/${zoneId}/email/routing/rules/catch_all`);
    const currentCatchAll = catchAllResp.result;
    const currentAction = currentCatchAll?.actions?.[0];
    const alreadyCorrect = currentCatchAll?.enabled
      && currentAction?.type === 'forward'
      && currentAction?.value?.[0] === desiredCatchAll.to;

    if (alreadyCorrect) {
      console.log(`      ${chalk.green('✓')} ${chalk.cyan('*')} → ${chalk.dim(desiredCatchAll.to)}`);
      skipped++;
    } else if (options.dryRun) {
      dryRunPlan(`set catch-all → ${desiredCatchAll.to}`);
      planned++;
    } else {
      console.log(`      ${chalk.dim('→')} Updating catch-all: ${chalk.cyan('*')} → ${chalk.dim(desiredCatchAll.to)}`);
      const putCatchAll = () => api.makeRequest(`/zones/${zoneId}/email/routing/rules/catch_all`, {
        method: 'PUT',
        body: JSON.stringify({
          matchers: [{ type: 'all' }],
          actions: [{ type: 'forward', value: [desiredCatchAll.to] }],
          enabled: true,
          name: 'Catch-all',
        }),
      });
      try {
        await putCatchAll();
        console.log(`      ${chalk.green('✓')} Updated`);
        updated++;
      } catch (error) {
        if (!isUnverifiedError(error)) throw error;
        const resolved = await handleUnverified(api, zoneId, desiredCatchAll.to, putCatchAll, options);
        if (resolved) {
          updated++;
        } else {
          unverified++;
        }
      }
    }
  }

  // --- Regular rules ---
  for (const desired of desiredRegular) {
    const matcherValue = `${desired.from}@${domain}`;

    const exists = existingRules.find((rule) => {
      if (!rule.matchers || !rule.actions) return false;
      const matcher = rule.matchers[0];
      const action = rule.actions[0];
      return matcher.type === 'literal'
        && matcher.value === matcherValue
        && action.value?.[0] === desired.to;
    });

    if (exists) {
      console.log(`      ${chalk.green('✓')} ${chalk.cyan(matcherValue)} → ${chalk.dim(desired.to)}`);
      skipped++;
      continue;
    }

    if (options.dryRun) {
      dryRunPlan(`create ${matcherValue} → ${desired.to}`);
      planned++;
      continue;
    }

    console.log(`      ${chalk.dim('→')} Creating rule: ${chalk.cyan(matcherValue)} → ${chalk.dim(desired.to)}`);

    const postRule = () => api.makeRequest(`/zones/${zoneId}/email/routing/rules`, {
      method: 'POST',
      body: JSON.stringify({
        matchers: [{ type: 'literal', field: 'to', value: matcherValue }],
        actions: [{ type: 'forward', value: [desired.to] }],
        enabled: true,
        name: `Forward ${matcherValue}`,
      }),
    });

    try {
      await postRule();
      console.log(`      ${chalk.green('✓')} Created`);
      created++;
    } catch (error) {
      if (!isUnverifiedError(error)) throw error;
      const resolved = await handleUnverified(api, zoneId, desired.to, postRule, options);
      if (resolved) {
        created++;
      } else {
        unverified++;
      }
    }
  }

  // Delete regular rules in Cloudflare that aren't in config (skip catch-all — managed separately)
  for (const existing of existingRules) {
    if (!existing.matchers || !existing.actions || !existing.enabled) continue;

    const matcher = existing.matchers[0];
    const action = existing.actions[0];
    if (action?.type !== 'forward') continue;
    if (matcher.type === 'all') continue;

    const isDesired = desiredRegular.some((desired) =>
      matcher.type === 'literal'
      && matcher.value === `${desired.from}@${domain}`
      && action.value?.[0] === desired.to,
    );

    if (!isDesired) {
      if (options.dryRun) {
        dryRunPlan(`remove ${matcher.value} → ${action.value?.[0]}`);
        planned++;
        continue;
      }
      console.log(`      ${chalk.dim('→')} Removing rule: ${chalk.cyan(matcher.value)} → ${chalk.dim(action.value?.[0])}`);
      await api.makeRequest(`/zones/${zoneId}/email/routing/rules/${existing.tag}`, { method: 'DELETE' });
      console.log(`      ${chalk.green('✓')} Removed`);
      deleted++;
    }
  }

  // Disable catch-all if not in config but currently active
  if (!desiredCatchAll) {
    const catchAllResp = await api.makeRequest(`/zones/${zoneId}/email/routing/rules/catch_all`);
    const currentCatchAll = catchAllResp.result;
    if (currentCatchAll?.enabled && currentCatchAll?.actions?.[0]?.type === 'forward') {
      if (options.dryRun) {
        dryRunPlan('disable catch-all (not in config)');
        planned++;
      } else {
        console.log(`      ${chalk.dim('→')} Disabling catch-all (not in config)`);
        await api.makeRequest(`/zones/${zoneId}/email/routing/rules/catch_all`, {
          method: 'PUT',
          body: JSON.stringify({
            matchers: [{ type: 'all' }],
            actions: [{ type: 'drop' }],
            enabled: false,
          }),
        });
        console.log(`      ${chalk.green('✓')} Disabled`);
        deleted++;
      }
    }
  }

  return {
    status: unverified > 0 ? 'warned' : 'success',
    output: { emailRouting: { enabled: true, created, updated, skipped, deleted, unverified, ...(planned > 0 && { planned }) } },
  };
};

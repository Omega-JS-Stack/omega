/**
 * Shared helpers for Cloudflare ruleset operations (cache, redirect,
 * configuration, response-headers, security). Ported from omega-manager with
 * one addition: applyRuleset honors dryRun (reports the planned write, makes
 * no API call).
 *
 * Cloudflare's "rulesets" feature backs many of its policies, all reachable via:
 *   GET    /zones/{id}/rulesets/phases/{phase}/entrypoint   (fetch)
 *   POST   /zones/{id}/rulesets                              (create when missing)
 *   PUT    /zones/{id}/rulesets/{rulesetId}                  (update existing)
 *
 * If the phase has never been used, Cloudflare returns "could not find
 * entrypoint ruleset" — detected here so the first write POSTs a new ruleset.
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

/**
 * Fetch the entrypoint ruleset for a phase. Returns { ruleset, needsCreate }.
 */
async function fetchRuleset(api, zoneId, phase) {
  try {
    const data = await api.makeRequest(`/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`);
    return { ruleset: data.result, needsCreate: false };
  } catch (error) {
    if (error.message.includes('10003') || error.message.includes('could not find entrypoint ruleset')) {
      return { ruleset: null, needsCreate: true };
    }
    throw error;
  }
}

/**
 * Apply rules to the zone — POST if the ruleset doesn't exist yet, PUT otherwise.
 * Logs success/failure with `label` (e.g. "Cache rules").
 *
 * Returns { updated, planned?, error? } suitable for the output field.
 */
async function applyRuleset(api, zoneId, { ruleset, needsCreate, rules, phase, name, description, label, dryRun = false }) {
  const output = { updated: false };

  if (dryRun) {
    dryRunPlan(`${needsCreate ? 'create' : 'update'} ${label} (${rules.length} rules)`);
    output.planned = needsCreate ? 'create' : 'update';
    return output;
  }

  try {
    if (needsCreate) {
      await api.makeRequest(`/zones/${zoneId}/rulesets`, {
        method: 'POST',
        body: JSON.stringify({ name, description, kind: 'zone', phase, rules }),
      });
      output.updated = true;
      console.log(`      ${chalk.green('✓')} ${label} created`);
    } else {
      await api.makeRequest(`/zones/${zoneId}/rulesets/${ruleset.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          rules,
          description: ruleset.description || description,
          kind: ruleset.kind,
          name: ruleset.name,
          phase: ruleset.phase,
        }),
      });
      output.updated = true;
      console.log(`      ${chalk.green('✓')} ${label} updated`);
    }
  } catch (error) {
    output.error = error.message;
    console.error(`      ${chalk.red('✗')} ${label} failed${chalk.dim(`: ${error.message}`)}`);
  }

  return output;
}

/**
 * Resolve the zone id for a handler: the zone operation's freshly-returned
 * state (serviceData) wins over the setup-time lookup — so a zone created
 * THIS run is visible to every later operation (omega-manager only saw it on
 * the next run).
 */
function getZoneId(context) {
  return context.serviceData?.zoneId ?? context.zoneId ?? null;
}

/**
 * Gate for zone-scoped operations: no zoneId means the zone doesn't exist
 * yet — reachable only in a dry-run (live runs create the zone first, its
 * id flowing through serviceData; cp113 made that true for subdomain
 * parents too), where the op plans instead of calling the API with
 * zones/null. Returns the handler's early return, or null to proceed.
 */
function zoneGate(context, key) {
  if (getZoneId(context)) {
    return null;
  }
  if (context.options?.dryRun) {
    return dryRunPlan(
      `reconcile ${key} once zone ${context.zoneDomain} exists`,
      { status: 'success', output: { [key]: { planned: 'after-zone' } } },
    );
  }
  return { status: 'warned', output: { [key]: { note: 'no zone available' } } };
}

module.exports = { fetchRuleset, applyRuleset, getZoneId, zoneGate };

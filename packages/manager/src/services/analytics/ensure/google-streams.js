/**
 * Ensure one GA4 web data stream per enabled target.
 *
 * Streams are found by URI (the source of truth — each target gets a unique
 * subdomain of the brand domain, virtual for app targets): create when
 * missing, rename on displayName drift, enhanced measurement DIFFED before
 * patching (omega-manager blind-PATCHed it every run), and a clean
 * Measurement Protocol secret per stream (no dashes/underscores — regenerated
 * until clean). Streams land in state as `streams.{target}` with the
 * measurementId + apiSecret the frameworks consume per surface.
 *
 * GA's "User Data Collection Acknowledgement" gate on secret creation has no
 * API — interactive runs open the settings page (Enter-gated, house rule)
 * and retry-poll until the acknowledgement lands, so ONE run finishes the
 * job; non-interactive runs warn with the URL and the rerun converges.
 * Acknowledging is per-property, so the first stream's prompt clears the
 * gate for every stream after it.
 */
const chalk = require('chalk').default;
const { pressEnterToOpen } = require('@omega.js/devkit/prompt');
const { pollWithSpinner } = require('@omega.js/devkit/flows');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');

// target → stream URI subdomain (null = the root domain) + display name.
// Subdomains for app targets are virtual — they exist only to give each
// target a distinct stream URI. Unlisted targets default to their own name.
const STREAM_TARGETS = {
  web: { displayName: 'Website', subdomain: null },
  backend: { displayName: 'Backend', subdomain: 'api' },
  desktop: { displayName: 'Desktop App', subdomain: 'desktop' },
  extension: { displayName: 'Browser Extension', subdomain: 'extension' },
  mobile: { displayName: 'Mobile App', subdomain: 'mobile' },
};

const SECRET_NAME = 'Secret';
const MAX_SECRET_ATTEMPTS = 20;

// Secrets get embedded in .env files and URLs downstream — dashes and
// underscores have burned enough tooling that omega-manager regenerated
// until the value was clean; the port keeps that rule
function isCleanSecret(secret) {
  return !secret.includes('-') && !secret.includes('_');
}

module.exports = async function ensureGoogleStreams(context) {
  const { analyticsApi: api, propertyId, accountId, domain, brand, brandConfig, brandState, serviceData, options = {} } = context;

  // Config drift check: a propertyId pointing at a deleted/inaccessible
  // property should say so instead of erroring cryptically per stream
  const property = await api.getProperty(propertyId);
  if (!property) {
    console.log(`      ${chalk.yellow('⚠')} GA property ${chalk.cyan(propertyId)} not found (deleted, or the authed account has no access)`);
    return { status: 'warned', output: { streams: { error: `property ${propertyId} not found` } } };
  }

  const existing = await api.listDataStreams(propertyId);
  console.log(`      ${chalk.dim('→')} Property ${chalk.cyan(propertyId)}: ${existing.length} existing stream(s)`);

  const enhancedMeasurement = brandConfig.analytics?.providers?.google?.enhancedMeasurement || {};

  const streams = { ...(serviceData.streams || {}) };
  let warned = false;
  const planned = [];

  for (const target of brand.targets) {
    const spec = STREAM_TARGETS[target] || { displayName: target, subdomain: target };
    const uri = spec.subdomain ? `https://${spec.subdomain}.${domain}` : `https://${domain}`;
    const displayName = `${brandConfig.brand.name} - ${spec.displayName}`;

    let stream = existing.find((s) => s.type === 'WEB_DATA_STREAM' && s.webStreamData?.defaultUri === uri);

    if (!stream) {
      if (options.dryRun) {
        dryRunPlan(`create ${target} stream (${uri})`);
        planned.push({ target, action: 'create', uri });
        continue;
      }
      console.log(`      ${chalk.dim('→')} Creating ${chalk.cyan(target)} stream (${uri})...`);
      stream = await api.createWebDataStream(propertyId, { defaultUri: uri, displayName });
      console.log(`      ${chalk.green('✓')} ${chalk.cyan(target)}: created`);
    } else {
      console.log(`      ${chalk.green('✓')} ${chalk.cyan(target)}: found by URI`);
    }

    const streamId = stream.name.split('/').pop();

    // Rename on drift only
    if (stream.displayName !== displayName) {
      if (options.dryRun) {
        planned.push({ target, action: 'rename', to: displayName });
      } else {
        await api.updateDataStream(propertyId, streamId, { displayName });
        console.log(`        ${chalk.green('✓')} Renamed to "${chalk.cyan(displayName)}"`);
      }
    }

    // Enhanced measurement — diff the configured keys against the live
    // settings; omega-manager PATCHed unconditionally on every run
    if (Object.keys(enhancedMeasurement).length > 0) {
      const current = await api.getEnhancedMeasurementSettings(propertyId, streamId);
      const drifted = Object.keys(enhancedMeasurement)
        .filter((key) => current?.[key] !== enhancedMeasurement[key]);
      if (drifted.length > 0) {
        if (options.dryRun) {
          planned.push({ target, action: 'enhanced-measurement', drifted });
        } else {
          await api.updateEnhancedMeasurementSettings(propertyId, streamId, enhancedMeasurement);
          console.log(`        ${chalk.green('✓')} Enhanced measurement updated (${drifted.join(', ')})`);
        }
      }
    }

    // Measurement Protocol secret
    let apiSecret = streams[target]?.apiSecret || null;
    try {
      const secrets = await api.listMeasurementProtocolSecrets(propertyId, streamId);
      const found = secrets.find((s) => s.displayName === SECRET_NAME);

      if (found && isCleanSecret(found.secretValue)) {
        apiSecret = found.secretValue;
      } else if (options.dryRun) {
        planned.push({ target, action: found ? 'replace-unclean-secret' : 'create-secret' });
      } else {
        if (found) {
          await api.deleteMeasurementProtocolSecret(propertyId, streamId, found.name.split('/').pop());
          console.log(`        ${chalk.dim('↻')} Deleted unclean secret`);
        }
        apiSecret = await createCleanSecret(api, propertyId, streamId);
        if (apiSecret) {
          console.log(`        ${chalk.green('✓')} API secret created`);
        } else {
          console.log(`        ${chalk.yellow('⚠')} Could not generate a clean secret in ${MAX_SECRET_ATTEMPTS} attempts`);
          warned = true;
        }
      }
    } catch (error) {
      if (error.message.includes('User Data Collection Acknowledgement')) {
        // No API for the acknowledgement — point at the stream settings page
        // (the account-scoped deep link needs accountId; fall back to the app)
        const settingsUrl = accountId
          ? `https://analytics.google.com/analytics/web/#/a${accountId}p${propertyId}/admin/streams/table/${streamId}`
          : 'https://analytics.google.com/analytics/web/';
        console.log(`        ${chalk.yellow('⚠')} Data collection acknowledgement required before secrets can be created`);

        if (canPrompt(options)) {
          await pressEnterToOpen(settingsUrl, 'the data-collection acknowledgement page');
          const poll = await pollWithSpinner({
            check: async () => {
              try {
                const secret = await createCleanSecret(api, propertyId, streamId);
                return { done: true, result: secret };
              } catch (retryError) {
                if (retryError.message.includes('User Data Collection Acknowledgement')) {
                  return { done: false };
                }
                return { done: true, error: retryError.message };
              }
            },
            intervalMs: 5000,
            message: 'Waiting for the acknowledgement',
          });

          if (poll.success && poll.result) {
            apiSecret = poll.result;
            console.log(`        ${chalk.green('✓')} API secret created`);
          } else {
            console.log(`        ${chalk.dim('→')} Still gated${poll.error ? chalk.dim(` (${poll.error})`) : ''} — rerun converges once acknowledged`);
            warned = true;
          }
        } else {
          console.log(`        ${chalk.dim('→')} Acknowledge at: ${chalk.cyan(settingsUrl)} — then rerun`);
          warned = true;
        }
      } else {
        console.log(`        ${chalk.yellow('⚠')} API secret${chalk.dim(`: ${error.message}`)}`);
        warned = true;
      }
    }

    streams[target] = {
      streamId,
      measurementId: stream.webStreamData?.measurementId || null,
      apiSecret,
      uri,
      displayName: options.dryRun ? stream.displayName : displayName,
    };
  }

  // A Firebase web app measures through its OWN measurementId — if this GA
  // property has no stream carrying it, Firebase is linked to a different
  // property (expected for shared projects, a real misconfig otherwise)
  const firebaseMeasurementId = brandState.firebase?.sdkConfig?.measurementId;
  if (firebaseMeasurementId && brandConfig.firebase?.shared !== true) {
    const covered = existing.some((s) => s.webStreamData?.measurementId === firebaseMeasurementId)
      || Object.values(streams).some((s) => s.measurementId === firebaseMeasurementId);
    if (!covered) {
      console.log(`      ${chalk.yellow('⚠')} Firebase SDK measures via ${chalk.cyan(firebaseMeasurementId)}, but property ${chalk.cyan(propertyId)} has no stream with that ID`);
      console.log(`      ${chalk.dim('→')} Firebase is likely linked to a different GA property — unlink in Firebase Console and rerun`);
      warned = true;
    }
  }

  const result = { state: { streams } };
  if (planned.length > 0) {
    result.output = { streams: { planned } };
  }
  if (warned) {
    result.status = 'warned';
  }
  return result;
};

async function createCleanSecret(api, propertyId, streamId) {
  for (let attempt = 1; attempt <= MAX_SECRET_ATTEMPTS; attempt++) {
    const created = await api.createMeasurementProtocolSecret(propertyId, streamId, SECRET_NAME);
    if (isCleanSecret(created.secretValue)) {
      return created.secretValue;
    }
    await api.deleteMeasurementProtocolSecret(propertyId, streamId, created.name.split('/').pop());
  }
  return null;
}

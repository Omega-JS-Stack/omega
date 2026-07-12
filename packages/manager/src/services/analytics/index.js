/**
 * Analytics service — reconciles the brand's analytics providers to
 * `analytics: {}` in omega.json5: one GA4 web data stream per enabled target
 * (with enhanced measurement + a Measurement Protocol secret each), the
 * GA property ↔ Firebase project link, and the Meta/TikTok pixel token
 * presence checks.
 *
 * Google auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env
 * (OAuth2; tokens cache to .omega/auth/google-analytics-tokens.json — the
 * analytics.edit scope is separate from the firebase service's tokens).
 * The GA4 property itself is required config (`analytics.providers.google.
 * propertyId`): interactive runs offer the account + property
 * selection/creation flow (lib/property-flow.js) and land the ids in
 * omega.json5. Without a propertyId (non-interactive/skipped)
 * or without Google credentials the two google operations are filtered out;
 * meta-pixel/tiktok-pixel are pure local checks and always run when their
 * provider ID is configured.
 */
const { googleTokenStorePath } = require('../../lib/google-auth.js');
const chalk = require('chalk').default;
const { createServiceRunner } = require('../../lib/service-runner.js');
const { GoogleAnalyticsAPI } = require('./lib/analytics-api.js');
const { resolveGoogleProperty } = require('./lib/property-flow.js');

// Operations that need the GA Admin API (and therefore propertyId + creds)
const GOOGLE_OPERATIONS = new Set(['google-streams', 'google-firebase-link']);

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const analytics = context.brandConfig.analytics || {};

    if (analytics.enabled === false) {
      return { skip: true, reason: 'analytics.enabled = false' };
    }

    const domain = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    const haveGoogleAuth = Boolean(
      context.analyticsApi
      || (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    );

    // Missing property + creds available → offer the interactive account +
    // property selection/creation flow (lands both ids in omega.json5, and
    // in the in-memory config re-read just below)
    if (!analytics.providers?.google?.propertyId && haveGoogleAuth) {
      const flowApi = context.analyticsApi || new GoogleAnalyticsAPI({
        tokenStorePath: googleTokenStorePath(context.brandRoot),
      });
      await resolveGoogleProperty(context, flowApi);
    }

    const providers = context.brandConfig.analytics?.providers || {};
    const google = providers.google || {};
    const metaId = providers.meta?.id;
    const tiktokId = providers.tiktok?.id;

    if (!google.propertyId && !metaId && !tiktokId) {
      return { skip: true, reason: 'no analytics providers configured (analytics.providers.google.propertyId / meta.id / tiktok.id)' };
    }

    // Decide whether the google operations can run this pass
    let operations = context.operations;
    if (!google.propertyId) {
      console.log(chalk.dim('    ⊘ google operations skipped — no analytics.providers.google.propertyId (rerun interactively to select/create the property)'));
      operations = operations.filter((op) => !GOOGLE_OPERATIONS.has(op.name));
    } else if (!haveGoogleAuth) {
      if (!metaId && !tiktokId) {
        return { skip: true, reason: 'no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET configured (set them in the brand .env)' };
      }
      console.log(chalk.dim('    ⊘ google operations skipped — no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET in the brand .env'));
      operations = operations.filter((op) => !GOOGLE_OPERATIONS.has(op.name));
    }

    const needsGoogleApi = operations.some((op) => GOOGLE_OPERATIONS.has(op.name));

    // Tests inject a fake client via context.analyticsApi
    return {
      analyticsApi: needsGoogleApi
        ? (context.analyticsApi || new GoogleAnalyticsAPI({
          tokenStorePath: googleTokenStorePath(context.brandRoot),
        }))
        : null,
      domain,
      propertyId: google.propertyId || null,
      accountId: google.accountId || null,
      operations,
    };
  },
});

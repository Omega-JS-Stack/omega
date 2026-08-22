/**
 * Analytics service — reconciles the brand's analytics providers to
 * `analytics: {}` in omega.json5: one GA4 web data stream per enabled target
 * (with enhanced measurement + a Measurement Protocol secret each), the
 * GA property ↔ Firebase project link, and the Meta/TikTok pixels — created
 * on their ad account when config has no id yet (#417), then checked for
 * their access token.
 *
 * Google auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env
 * (OAuth2; tokens cache to .omega/auth/google-analytics-tokens.json — the
 * analytics.edit scope is separate from the cloud service's tokens).
 * The GA4 property itself is required config (`analytics.providers.google.
 * propertyId`): interactive runs offer the account + property
 * selection/creation flow (lib/property-flow.js) and land the ids in
 * omega.json5. Without a propertyId (non-interactive/skipped)
 * or without Google credentials the two google operations are filtered out.
 *
 * Pixel auth: META_ACCESS_TOKEN / TIKTOK_ACCESS_TOKEN in the brand .env (the
 * names @omega.js/backend reads — one token per platform serves both the
 * create and the conversions sender). A pixel operation runs whenever its
 * provider has an id (token check) or an accountId to create under, and —
 * Meta, whose token names its own ad accounts — whenever the token is in hand
 * or the run can ask for one (lib/pixel-provision.js hasPixelWork). A missing
 * token warns with guidance and never fails; `analytics.providers.{provider}:
 * false` disables the provider and stops every ask.
 */
const { googleTokenStorePath } = require('../../lib/google-auth.js');
const chalk = require('chalk').default;
const { createServiceRunner } = require('../../lib/service-runner.js');
const { GoogleAnalyticsAPI } = require('./lib/analytics-api.js');
const { MetaMarketingAPI } = require('./lib/meta-api.js');
const { TikTokBusinessAPI } = require('./lib/tiktok-api.js');
const { resolveGoogleProperty } = require('./lib/property-flow.js');
const { hasPixelWork } = require('./lib/pixel-provision.js');
const { META_PIXEL, TIKTOK_PIXEL } = require('./lib/pixel-specs.js');

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
    const meta = providers.meta || {};
    const tiktok = providers.tiktok || {};

    // A pixel half has work when its id is configured (token check), an
    // account id names where to create it, or — Meta — a token in hand (or an
    // interactive run that can ask for one) can discover the account itself
    const metaWork = hasPixelWork(context.brandConfig, META_PIXEL, context.options);
    const tiktokWork = hasPixelWork(context.brandConfig, TIKTOK_PIXEL, context.options);
    const havePixelWork = metaWork || tiktokWork;

    if (!google.propertyId && !havePixelWork) {
      return { skip: true, reason: 'no analytics providers configured (analytics.providers.google.propertyId / meta.{id,accountId} / tiktok.{id,accountId})' };
    }

    // Decide whether the google operations can run this pass
    let operations = context.operations;
    if (!google.propertyId) {
      console.log(chalk.dim('    ⊘ google operations skipped — no analytics.providers.google.propertyId (rerun interactively to select/create the property)'));
      operations = operations.filter((op) => !GOOGLE_OPERATIONS.has(op.name));
    } else if (!haveGoogleAuth) {
      if (!havePixelWork) {
        return { skip: true, reason: 'no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET configured (set them in the brand .env)' };
      }
      console.log(chalk.dim('    ⊘ google operations skipped — no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET in the brand .env'));
      operations = operations.filter((op) => !GOOGLE_OPERATIONS.has(op.name));
    }

    const needsGoogleApi = operations.some((op) => GOOGLE_OPERATIONS.has(op.name));

    // A pixel client is built only for a provisioning pass — a brand whose
    // pixel id is already config never touches the platform's API
    const needsPixelApi = (work, provider) => Boolean(work && !provider.id);

    // Tests inject fake clients via context.analyticsApi/metaApi/tiktokApi
    return {
      analyticsApi: needsGoogleApi
        ? (context.analyticsApi || new GoogleAnalyticsAPI({
          tokenStorePath: googleTokenStorePath(context.brandRoot),
        }))
        : null,
      metaApi: context.metaApi || (needsPixelApi(metaWork, meta) ? new MetaMarketingAPI() : null),
      tiktokApi: context.tiktokApi || (needsPixelApi(tiktokWork, tiktok) ? new TikTokBusinessAPI() : null),
      domain,
      propertyId: google.propertyId || null,
      accountId: google.accountId || null,
      operations,
    };
  },
});

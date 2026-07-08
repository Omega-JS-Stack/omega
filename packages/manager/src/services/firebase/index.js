/**
 * Firebase service — reconciles the brand's Firebase/GCP project to
 * `firebase: {}` in omega.json5: Blaze billing, required Google Cloud APIs,
 * project identity, OAuth consent screen, Admin SDK service account + key,
 * Hosting api.{domain} custom domains (DNS via Cloudflare), Firestore (+PITR),
 * Realtime Database, Authentication (Identity Platform + sign-in methods),
 * Storage, Cloud Functions readiness, Cloud Messaging, and the web SDK config.
 *
 * Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env (OAuth2;
 * tokens cache to .omega/auth/google-tokens.json — the first run prints an
 * auth URL). No credentials → the service skips. Project creation rides the
 * onboarding port: no firebase.projectId → skip with guidance.
 *
 * `firebase.shared: true` (project shared by multiple brands) filters to the
 * per-brand operations only (service-account, sdk-config) so one brand never
 * rewrites a shared project's settings.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const { createServiceRunner } = require('../../lib/service-runner.js');
const { CloudflareAPI } = require('../cloudflare/lib/cloudflare-api.js');
const { getApexDomain } = require('../../lib/domain-utils.js');
const { FirebaseAPI } = require('./lib/firebase-api.js');

// Operations that stay on for shared projects (per-brand, not project-level)
const SHARED_OPERATIONS = new Set(['service-account', 'sdk-config']);

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const firebase = context.brandConfig.firebase || {};

    if (firebase.enabled === false) {
      return { skip: true, reason: 'firebase.enabled = false' };
    }

    if (!firebase.projectId) {
      return { skip: true, reason: 'no firebase.projectId configured (project selection/creation rides the onboarding port)' };
    }

    if (!context.firebaseApi && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) {
      return { skip: true, reason: 'no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET configured (set them in the brand .env)' };
    }

    const domain = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    const shared = firebase.shared === true;
    console.log(`    Project: ${chalk.cyan(firebase.projectId)}${shared ? chalk.dim(' (shared)') : ''}`);

    // Tests inject fake clients via context.firebaseApi / context.cloudflareApi.
    // Cloudflare is only needed by the hosting operation (custom-domain DNS);
    // without a token the operation reports the required records instead.
    const firebaseApi = context.firebaseApi || new FirebaseAPI({
      tokenStorePath: join(context.brandRoot, '.omega', 'auth', 'google-tokens.json'),
    });
    const cloudflareApi = context.cloudflareApi
      || (process.env.CLOUDFLARE_TOKEN ? new CloudflareAPI() : null);

    const apexDomain = getApexDomain(domain);

    return {
      firebaseApi,
      cloudflareApi,
      projectId: firebase.projectId,
      domain,
      apexDomain,
      isSubdomainProject: domain !== apexDomain,
      operations: shared
        ? context.operations.filter((op) => SHARED_OPERATIONS.has(op.name))
        : context.operations,
    };
  },
});

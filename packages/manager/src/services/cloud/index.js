/**
 * Cloud service (Firebase provider) — reconciles the brand's Firebase/GCP project to
 * `firebase: {}` in omega.json5: Blaze billing, required Google Cloud APIs,
 * project identity, OAuth consent screen, Admin SDK service account + key,
 * Hosting api.{domain} custom domains (DNS via Cloudflare), Firestore (+PITR),
 * Realtime Database, Authentication (Identity Platform + sign-in methods),
 * Storage, Cloud Functions readiness, Cloud Messaging, and the web SDK config.
 *
 * Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env (OAuth2;
 * tokens cache to .omega/auth/google-tokens.json — the first run prints an
 * auth URL). No credentials → the service skips. No firebase.projectId →
 * interactive runs offer the project selection/creation flow
 * (lib/project-flow.js, lands the id in omega.json5); otherwise skip with
 * guidance.
 *
 * `firebase.shared: true` (project shared by multiple brands) filters to the
 * per-brand operations only (service-account, sdk-config) so one brand never
 * rewrites a shared project's settings.
 */
const { googleTokenStorePath } = require('../../lib/google-auth.js');
const { isDemoProject } = require('@omega.js/config');
const chalk = require('chalk').default;
const { createServiceRunner } = require('../../lib/service-runner.js');
const { CloudflareAPI } = require('../cloudflare/lib/cloudflare-api.js');
const { getApexDomain } = require('../../lib/domain-utils.js');
const { FirebaseAPI } = require('./lib/firebase-api.js');
const { resolveFirebaseProject } = require('./lib/project-flow.js');

// Operations that stay on for shared projects (per-brand, not project-level)
const SHARED_OPERATIONS = new Set(['service-account', 'sdk-config']);

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const firebase = context.brandConfig.firebase || {};

    if (firebase.enabled === false) {
      return { skip: true, reason: 'firebase.enabled = false' };
    }

    const haveCreds = Boolean(
      context.firebaseApi
      || (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    );

    // Tests inject fake clients via context.firebaseApi / context.cloudflareApi.
    // Cloudflare is only needed by the hosting operation (custom-domain DNS);
    // without a token the operation reports the required records instead.
    const makeApi = () => context.firebaseApi || new FirebaseAPI({
      tokenStorePath: googleTokenStorePath(context.brandRoot),
    });

    // firebase.projectId, falling back to the client web config — a brand
    // that ran the framework flow first (setup/dev) already names the project
    // in cloud.config. Still missing → offer the interactive selection/
    // creation flow (lands firebase.projectId in omega.json5); needs credentials
    let projectId = firebase.projectId || context.brandConfig.cloud?.config?.projectId;
    if (!projectId && haveCreds) {
      projectId = await resolveFirebaseProject(context, makeApi());
    }
    if (!projectId) {
      return { skip: true, reason: 'no firebase.projectId configured (rerun interactively to select/create the project)' };
    }

    // demo-* = emulator-only by Firebase's own convention: no real GCP
    // project exists to reconcile (found live 2026-07-19 — the omega brand's
    // offline demo-omega id sent the ensure at real Google APIs → 403,
    // killing the whole manage boot).
    if (isDemoProject(projectId)) {
      return { skip: true, reason: `${projectId} is a demo-* (emulator-only) project — no real cloud to reconcile` };
    }

    if (!haveCreds) {
      return { skip: true, reason: 'no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET configured (set them in the brand .env)' };
    }

    const domain = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    const firebaseApi = makeApi();

    const shared = firebase.shared === true;
    console.log(`    Project: ${chalk.cyan(projectId)}${shared ? chalk.dim(' (shared)') : ''}`);
    const cloudflareApi = context.cloudflareApi
      || (process.env.CLOUDFLARE_TOKEN ? new CloudflareAPI() : null);

    const apexDomain = getApexDomain(domain);

    return {
      firebaseApi,
      cloudflareApi,
      projectId,
      domain,
      apexDomain,
      isSubdomainProject: domain !== apexDomain,
      operations: shared
        ? context.operations.filter((op) => SHARED_OPERATIONS.has(op.name))
        : context.operations,
    };
  },
});

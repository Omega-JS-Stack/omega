/**
 * Disperse service — the remnant of omega-manager's disperse after the
 * config hierarchy dissolved file dispersal: apps read config/omega.json5
 * directly, so there is no .brands/ mirror and no per-repo config writes
 * (the old repos/products/pricing-md/cdn operations). What can't ride the
 * hierarchy is exactly what this service still moves:
 *
 *   certs — signing artifacts (binary, never mergeable) copied from the
 *           certificates service's .omega/certificates/apple/ tree into
 *           each desktop/mobile app's certs dir.
 *   env   — per-app .env composition (secrets hard-fail in omega.json5 by
 *           design): brand-level env values, per-surface analytics stream
 *           secrets, and app-relative signing paths land in each app's
 *           gitignored .env so the app's own tooling (builds, `npx mgr
 *           push-secrets`) works without the manager in front.
 *
 * De-ITW'd from omega-manager: the company-wide .output/_shared/ cert tree
 * and .brands/{id}/.env override layer are gone — artifacts are brand-local
 * (.omega/certificates/apple/) and manage.js already layers shell env >
 * brand .env > company .env before any service runs.
 *
 * Runs after certificates (the artifacts must exist) and before update
 * (builds read the composed .env + cert files).
 */
const { createServiceRunner } = require('../../lib/service-runner.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const targetApps = (context.apps || []).filter((app) => app.target);

    if (targetApps.length === 0) {
      return { skip: true, reason: 'no target-mapped apps' };
    }

    return { targetApps };
  },
});

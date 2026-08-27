/**
 * Disperse service — the remnant of omega-manager's disperse after the
 * config hierarchy dissolved file dispersal: targets read config/omega.json5
 * directly, so there is no .brands/ mirror and no per-repo config writes
 * (the old repos/products/pricing-md/cdn operations). What can't ride the
 * hierarchy is exactly what this service still moves:
 *
 *   certs — signing artifacts (binary, never mergeable) copied from the
 *           certificates service's .omega/certificates/apple/ tree into
 *           each desktop/mobile target's certs dir.
 *   env   — per-target .env composition (secrets hard-fail in omega.json5 by
 *           design): brand-level env values, per-surface analytics stream
 *           secrets, and target-relative signing paths land in each target's
 *           gitignored .env so the target's own tooling (builds, `npx omega
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
    // Custom targets (#603) ride along: they are one of the two ops that see
    // them at all, because a non-OMEGA target has no @omega.js/config to walk
    // the brand cascade with and needs its .env composed for it.
    const mappedTargets = (context.targets || []).filter((entry) => entry.target || entry.custom);

    if (mappedTargets.length === 0) {
      return { skip: true, reason: 'no target-mapped dirs' };
    }

    return { mappedTargets };
  },
});

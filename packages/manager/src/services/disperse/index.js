/**
 * Disperse service — the remnant of omega-manager's disperse after the
 * config hierarchy dissolved file dispersal: targets read config/omega.json5
 * directly, so there is no .brands/ mirror and no per-repo config writes
 * (the old repos/products/pricing-md/cdn operations). What can't ride the
 * hierarchy is exactly what this service still moves:
 *
 *   certs — signing artifacts (binary, never mergeable) copied from the
 *           certificates service's .omega/certificates/apple/ tree into
 *           each desktop/mobile target's certs dir. The copy itself is
 *           devkit's (`@omega.js/devkit/certs`), so a desktop build reaches
 *           the same artifacts through the same rules (#678).
 *
 * The .env composition is GONE (#678): the brand-root .env is the one file
 * humans and the manager edit, and every verb composes its target's runtime
 * env from the cascade by schema — no machine writes a target .env. A CUSTOM
 * target has no @omega.js/config to walk the cascade for it, so it inherits
 * instead: manage.js loads the env chain into process.env before it spawns
 * anything, and a custom target started by `omega dev`/`omega deploy` gets the
 * brand keys that way. A standalone run inside the target dir does not.
 *
 * De-ITW'd from omega-manager: the company-wide .output/_shared/ cert tree
 * and .brands/{id}/.env override layer are gone — artifacts are brand-local
 * (.omega/certificates/apple/) and manage.js already layers shell env >
 * brand .env > company .env before any service runs.
 *
 * Runs on the DELIVERY lane (config.js BOOT_SERVICES): every `omega dev`
 * boot, every brand-root `omega deploy`, and the full manage walk — after
 * certificates (the artifacts must exist) and before update (builds read the
 * cert files).
 */
const { createServiceRunner } = require('../../lib/service-runner.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const mappedTargets = (context.targets || []).filter((entry) => entry.target);

    if (mappedTargets.length === 0) {
      return { skip: true, reason: 'no target-mapped dirs' };
    }

    return { mappedTargets };
  },
});

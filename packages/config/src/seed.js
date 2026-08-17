/**
 * Layer-aware consumer config seeding (dogfood friction #1).
 *
 * Every framework's setup seeds a consumer config/omega.json5. WHETHER it
 * seeds at all depends on where the app lives:
 *
 *   - inside a brand monorepo ({brand}/apps/{app}) → NO app-layer file: the
 *     brand root's config/omega.json5 owns the shared sections (brand
 *     identity, cloud, payment, …) and its `targets.*` is the per-target
 *     home, so the framework template SKIPS the config entirely (a seed
 *     would shadow the brand layer — the "My Brand ×22" bug — and keep
 *     resurrecting a deliberately deleted app file on every setup).
 *   - standalone consumer → the framework's full template, placeholders and
 *     all (there is no brand layer to inherit from).
 *
 * This module is the ONE home for that decision so the four frameworks can't
 * drift. Standalone templates stay framework-owned.
 */

const { findBrandRoot } = require('./load.js');

/**
 * Decide which seed an app dir should get. Thin wrapper over findBrandRoot so
 * seeding call sites read as intent.
 *
 * @param {string} appDir - The consumer app dir (or its functions/ dir)
 * @returns {{ standalone: boolean, brandRoot: string|null }}
 */
function resolveSeedMode(appDir) {
  const brandRoot = findBrandRoot(appDir);
  return { standalone: !brandRoot, brandRoot };
}

module.exports = { resolveSeedMode };

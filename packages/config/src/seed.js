/**
 * Layer-aware consumer config seeding (dogfood friction #1).
 *
 * Every framework's setup seeds a consumer config/omega.json5. The SHAPE must
 * depend on where the app lives:
 *
 *   - inside a brand monorepo ({brand}/apps/{app}) → TARGETS-ONLY: the brand
 *     root's config/omega.json5 owns the shared sections (brand identity,
 *     cloud, payment, …); a full app-layer seed would SHADOW them (app wins
 *     the cascade — the "My Brand ×22" bug).
 *   - standalone consumer → the framework's full template, placeholders and
 *     all (there is no brand layer to inherit from).
 *
 * This module is the ONE home for the brand-app seed so the four frameworks
 * can't drift. Standalone templates stay framework-owned.
 */

const { findBrandRoot } = require('./load.js');

/**
 * Render the targets-only app-layer seed for an app inside a brand monorepo.
 *
 * @param {string} target - The app's target key ('web' | 'backend' | 'desktop' | 'extension' | 'mobile')
 * @returns {string} JSON5 file contents
 */
function renderBrandAppSeed(target) {
  return `// App-layer config — TARGETS ONLY. Shared sections (brand, cloud, payment, …)
// live in the brand root's config/omega.json5; any key added here OVERRIDES
// the brand layer for THIS app only, so keep it minimal.
{
  targets: {
    ${target}: {},
  },
}
`;
}

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

module.exports = { renderBrandAppSeed, resolveSeedMode };

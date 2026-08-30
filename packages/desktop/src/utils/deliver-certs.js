/**
 * Signing-artifact delivery on the desktop verbs
 * ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)).
 *
 * The copy itself is devkit's (`@omega.js/devkit/certs`) — the ONE delivery
 * step, the same rules the manager's disperse writer rides. What lives here is
 * the desktop FRAMING: which root holds the signing tree, the brand block the
 * `{brand.id}` rules resolve from, and this framework's own voice.
 *
 * The source root is the COMPANY root when the brand is company-managed (the
 * `.omega/company.json` stamp @omega.js/config reads), the brand root
 * otherwise — the same rule disperse used, read through the same one reader.
 * A target outside a brand has no tree and no delivery.
 */
const jetpack = require('fs-jetpack');
const { findBrandRoot, readCompanyRoot, loadConfig } = require('@omega.js/config');
const { deliverCerts, certsSourceDir } = require('@omega.js/devkit/certs');

/**
 * The root holding `.omega/certificates/apple/` for a target: the company
 * workspace when one is stamped, else the brand root.
 *
 * @param {string} projectDir - The target root.
 * @returns {string|null} The source root, or null when the target is not in a brand.
 */
function resolveSourceRoot(projectDir) {
  const brandRoot = findBrandRoot(projectDir);
  if (!brandRoot) return null;

  return readCompanyRoot(brandRoot) || brandRoot;
}

/**
 * Deliver this target's Apple artifacts into its own certs dir, so signing
 * finds them on every verb rather than only after a manage run.
 *
 * Reports and returns; it never throws. A brandless target, a tree that was
 * never produced, or a missing artifact are all normal states — the signing
 * lookup and validate-certs are what judge them.
 *
 * @param {object} input
 * @param {string} input.projectDir - The target root.
 * @param {object} input.logger - `{ log, warn, error }`.
 * @returns {{ copied: string[], current: string[], missing: string[] }|null} null when there is no tree.
 */
function deliverTargetCerts({ projectDir, logger }) {
  const sourceRoot = resolveSourceRoot(projectDir);
  if (!sourceRoot || !jetpack.exists(certsSourceDir(sourceRoot))) {
    return null;
  }

  let brand = null;
  try {
    brand = loadConfig(projectDir, 'desktop').config.brand || null;
  } catch (e) {
    // Unloadable config — the `{brand.id}` rules simply resolve empty; the
    // required rules below still deliver.
  }

  const result = deliverCerts({ sourceRoot, targetDir: projectDir, target: 'desktop', brand });

  if (result.copied.length > 0) {
    logger.log(`Delivered signing artifacts: ${result.copied.join(', ')}`);
  }

  return result;
}

module.exports = { deliverTargetCerts, resolveSourceRoot };

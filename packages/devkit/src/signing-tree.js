/**
 * The signing tree, in TWO tiers: the ONE resolution of where Apple signing
 * material is read from and written to
 * ([#892](https://github.com/Omega-JS-Stack/omega/issues/892)).
 *
 * ONE Apple account signs everything a company ships, so a brand that names a
 * company ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)) REUSES
 * that company's material instead of minting its own:
 *
 *   READ    company tree first (`<companyRoot>/.omega/certificates/apple/`),
 *           then the brand's own. The tier a file came from is part of the
 *           answer, so a walk can say "reused from company".
 *   WRITE   the company tree when there is one, the brand tree otherwise. New
 *           material a company-managed brand produces belongs to the company.
 *
 * Every consumer resolves through this one function: the manager's certificates
 * walk, the manager's disperse writer, and the desktop verbs' own delivery (the
 * `omega deploy --local` lane), which has no manager context and reads the
 * company root through @omega.js/config's resolver instead.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const { resolveCompany } = require('@omega.js/config');

const APPLE_REL = join('.omega', 'certificates', 'apple');

/**
 * The signing tree a root holds: the ONE home of that path.
 *
 * @param {string} root - Company tree root or brand root.
 * @returns {string} Absolute path to .omega/certificates/apple/.
 */
function certsSourceDir(root) {
  return join(root, APPLE_REL);
}

/**
 * The company TREE a brand inherits from (`<parent root>/company`), or null.
 * The manager hands its own `context.companyRoot`; everything else asks here.
 *
 * @param {string|null} brandRoot - The brand root.
 * @returns {string|null}
 */
function companyTree(brandRoot) {
  return brandRoot ? (resolveCompany(brandRoot).dir || null) : null;
}

/**
 * Resolve a brand's signing tree.
 *
 * @param {object} input
 * @param {string|null} input.brandRoot - The brand root (null outside a brand).
 * @param {string|null} [input.companyRoot] - The company TREE, when the caller
 *   already resolved it (the manager's context does). Pass nothing and it is
 *   resolved from the brand root.
 * @returns {{ writeDir: string|null, readDirs: string[], companyDir: string|null,
 *   brandDir: string|null, find: Function, path: Function }}
 *   `find(rel)` answers `{ path, source }` for the first tier holding that
 *   relative path (company first), null when neither does; `path(rel)` is where
 *   a WRITE of it goes.
 */
function signingTree({ brandRoot = null, companyRoot } = {}) {
  const company = companyRoot === undefined ? companyTree(brandRoot) : companyRoot;
  const companyDir = company ? certsSourceDir(company) : null;
  const brandDir = brandRoot ? certsSourceDir(brandRoot) : null;

  // Company FIRST, always: a brand of a company reuses its material.
  const tiers = [
    ...(companyDir ? [{ dir: companyDir, source: 'company' }] : []),
    ...(brandDir ? [{ dir: brandDir, source: 'brand' }] : []),
  ];
  const writeDir = companyDir || brandDir;

  return {
    writeDir,
    readDirs: tiers.map((tier) => tier.dir),
    companyDir,
    brandDir,
    find: (rel) => {
      for (const tier of tiers) {
        const candidate = join(tier.dir, rel);
        if (jetpack.exists(candidate)) {
          return { path: candidate, source: tier.source };
        }
      }
      return null;
    },
    path: (rel) => (writeDir ? join(writeDir, rel) : null),
  };
}

module.exports = { signingTree, certsSourceDir, companyTree, APPLE_REL };

/**
 * The company layer's ONE discovery rule.
 *
 * A brand managed by a company workspace carries `.omega/company.json` at its
 * root (stamped idempotently by company manage runs) pointing at the company
 * root. Everything that cascades — the config chain (load.js), the .env chain
 * (env.js), owner hooks (hooks.js) — resolves the company root through here,
 * so the stamp is read exactly one way.
 */

const fs = require('node:fs');
const path = require('node:path');

// A brand's pointer at its company root.
const COMPANY_MARKER = path.join('.omega', 'company.json');

/**
 * The company root a brand points at via its .omega/company.json marker.
 * @param {string} brandRoot
 * @returns {string|null} Absolute company root, or null when unstamped/unreadable.
 */
function readCompanyRoot(brandRoot) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(brandRoot, COMPANY_MARKER), 'utf8'));
    return typeof marker.root === 'string' && marker.root ? marker.root : null;
  } catch {
    return null;
  }
}

module.exports = { readCompanyRoot, COMPANY_MARKER };

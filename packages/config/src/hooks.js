/**
 * Company/brand hooks — owner-supplied code the frameworks call at named
 * hook points, so company-specific logic (e.g. a password formula) lives in
 * the OWNER'S tree, never in framework source.
 *
 * Layout is NESTED, mirroring the call site that invokes the hook (decided
 * with Ian 2026-07-10): the account service's password step loads
 * `config/hooks/account/password.js`, a future onboarding hook would live
 * under `config/hooks/onboard/…` — one file per hook point, path = the
 * invoking structure, never a flat name-mangled file.
 *
 * Hooks live under `config/` — the established home for owner-authored
 * omega inputs (omega.json5, seo.json5, chatsy.md, …) — and are therefore
 * VERSIONED by default (Ian 2026-07-11: hooks are authored code, and a
 * gitignored hook lost on a fresh clone would silently change behavior —
 * e.g. account passwords falling back to the seed channel). Never `.omega/`,
 * which is machine-owned bookkeeping. Secrets still belong in .env — a hook
 * that needs one reads process.env; owners who truly want a hook out of git
 * add their own `config/hooks/` ignore line.
 *
 * Resolution walks the same hierarchy as the .env cascade: the brand root's
 * own `config/hooks/` first, then the company root's (via the
 * .omega/company.json stamp) — so a company-wide hook covers every brand and
 * a single brand can still override it. Hooks are plain CJS modules whose
 * `module.exports` IS the hook function; call-site docs define each hook's
 * signature and return contract.
 */

const fs = require('node:fs');
const path = require('node:path');

const { readCompanyRoot } = require('./env.js');

// Hook points are code-owned kebab-case path constants ('account/password') —
// enforce the shape so a typo'd or traversal-shaped path fails loudly.
const HOOK_PATH_PATTERN = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

/**
 * The candidate file for one hook point under one root.
 */
function hookFile(root, hookPath) {
  return path.join(root, 'config', 'hooks', ...hookPath.split('/')) + '.js';
}

/**
 * Resolve a hook point to the file that defines it: the brand root's own
 * `config/hooks/<hookPath>.js`, else the company root's (company.json stamp).
 *
 * @param {string} startRoot - Brand (or standalone-project) root
 * @param {string} hookPath - Call-site-mirroring hook point, e.g. 'account/password'
 * @returns {string|null} Absolute hook file path, or null when neither root defines it
 */
function resolveHook(startRoot, hookPath) {
  if (!HOOK_PATH_PATTERN.test(hookPath)) {
    throw new Error(`Invalid hook path ${JSON.stringify(hookPath)} — kebab-case segments joined by '/', e.g. 'account/password'`);
  }

  const roots = [path.resolve(startRoot)];
  const companyRoot = readCompanyRoot(roots[0]);
  if (companyRoot && companyRoot !== roots[0]) {
    roots.push(companyRoot);
  }

  return roots.map((root) => hookFile(root, hookPath)).find((file) => fs.existsSync(file)) || null;
}

/**
 * Load a hook point's function. Absent hooks return null (callers fall
 * through to their default behavior); a hook file that exists but is broken
 * — unloadable, or not exporting a function — throws, because an owner who
 * wrote a hook must never get silent fallback.
 *
 * @param {string} startRoot - Brand (or standalone-project) root
 * @param {string} hookPath - Call-site-mirroring hook point, e.g. 'account/password'
 * @returns {{ fn: Function, file: string }|null}
 */
function loadHook(startRoot, hookPath) {
  const file = resolveHook(startRoot, hookPath);
  if (!file) return null;

  let exported;
  try {
    exported = require(file);
  } catch (e) {
    throw new Error(`Hook ${hookPath} failed to load (${file}): ${e.message}`);
  }

  // CJS module.exports = fn is the contract; tolerate an ESM default export
  const fn = typeof exported === 'function' ? exported : exported?.default;
  if (typeof fn !== 'function') {
    throw new Error(`Hook ${hookPath} (${file}) must export a function (module.exports = ({ … }) => …)`);
  }

  return { fn, file };
}

module.exports = { resolveHook, loadHook };

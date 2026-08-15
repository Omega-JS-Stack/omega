/**
 * Company-workspace helpers — the COMPANY → BRAND rung of the hierarchy
 * (Task M3 design, settled 2026-07-07).
 *
 * A company root is a directory whose config/omega.json5 has a `brands` key:
 *
 *   brands: { roots: ['./brands'] }   // dirs to scan, RELATIVE to the
 *                                     // company root (never absolute)
 *
 * Anything under a root with its own config/omega.json5 is a brand. A brand
 * behaves IDENTICALLY everywhere (standalone / nested / loose sibling) — the
 * company layer only changes what defaults it inherits:
 *
 *   manager DEFAULTS ← company omega.json5 ← brand ← app …  (config)
 *   company .env ← brand .env ← shell env                    (secrets)
 *
 * The reverse link without nesting: company runs idempotently stamp
 * `.omega/company.json` ({ root }) into each managed brand; brand-local runs
 * read the stamp and layer the company config + .env, warn when it's stale,
 * and run standalone when it's absent.
 */

const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');
const jetpack = require('fs-jetpack');

const { resolveConfigPath, hasOmegaConfig, findSecretKeys, readCompanyRoot, COMPANY_MARKER } = require('@omega.js/config');
const { resolveBrandRoot } = require('./brand.js');
const { stripLeadingVerb } = require('./argv.js');

const DEFAULT_BRAND_ROOTS = ['./brands'];

/**
 * Raw config/omega.json5 read — no merge, no validation, null when the file
 * is missing or unparseable (discovery must never throw on a broken brand;
 * the brand's own workspace service reports it).
 */
function readRawConfig(dir) {
  const configPath = resolveConfigPath(dir);
  if (!configPath) return null;

  try {
    return JSON5.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Is this directory a company root (config with a `brands` key)?
 */
function isCompanyRoot(dir) {
  return !!readRawConfig(dir)?.brands;
}

/**
 * Resolve what kind of root contains startDir: the nearest omega.json5 root
 * (brand walk-up rules), classified as company or brand.
 *
 * @returns {{ root: string, isCompany: boolean }|null}
 */
function resolveManageRoot(startDir) {
  const root = resolveBrandRoot(startDir);
  if (!root) return null;

  return { root, isCompany: isCompanyRoot(root) };
}

/**
 * Discover the brands a company manages: for each entry in brands.roots
 * (relative to the company root), every immediate child directory with a
 * config/omega.json5 is a brand. The company root itself and nested company
 * configs are skipped (one rung: company → brands).
 *
 * Throws on config mistakes (absolute or missing roots); broken brand
 * configs do NOT throw — the brand is listed and its own run reports them.
 *
 * @param {string} companyRoot - Absolute company root
 * @returns {{ brands: Array<{ id, name, dirName, root, enabled }>, skipped: Array<{ dir, reason }> }}
 */
function discoverBrands(companyRoot) {
  const raw = readRawConfig(companyRoot) || {};
  const roots = raw.brands?.roots || DEFAULT_BRAND_ROOTS;

  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error('brands.roots must be a non-empty array of directories relative to the company root');
  }

  const companyReal = fs.realpathSync(companyRoot);
  const seen = new Set();
  const brands = [];
  const skipped = [];

  for (const rootSpec of roots) {
    if (path.isAbsolute(rootSpec)) {
      throw new Error(`brands.roots entries must be RELATIVE to the company root — got absolute path: ${rootSpec}`);
    }

    const scanDir = path.resolve(companyRoot, rootSpec);
    if (!fs.existsSync(scanDir)) {
      throw new Error(`brands root not found: ${rootSpec} (${scanDir})`);
    }

    for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const brandDir = path.join(scanDir, entry.name);
      const real = fs.realpathSync(brandDir);
      if (real === companyReal || seen.has(real)) continue;

      if (!hasOmegaConfig(brandDir)) continue;
      seen.add(real);

      const brandRaw = readRawConfig(brandDir);
      if (brandRaw?.brands) {
        skipped.push({ dir: brandDir, reason: 'nested company workspace (one rung: company → brands)' });
        continue;
      }

      brands.push({
        id: brandRaw?.brand?.id || entry.name,
        name: brandRaw?.brand?.name || brandRaw?.brand?.id || entry.name,
        dirName: entry.name,
        root: brandDir,
        enabled: brandRaw?.enabled !== false,
      });
    }
  }

  brands.sort((a, b) => a.id.localeCompare(b.id));
  return { brands, skipped };
}

/**
 * The company config layer a brand inherits: the raw company omega.json5
 * minus the `brands` key (company plumbing, meaningless inside a brand).
 * Hard-fails on secret-shaped keys — same rule as every omega.json5.
 */
function loadCompanyConfig(companyRoot) {
  const raw = readRawConfig(companyRoot);
  if (!raw) return {};

  const secretKeys = findSecretKeys(raw);
  if (secretKeys.length > 0) {
    throw new Error(
      `Secret-shaped keys in company config ${companyRoot}: ${secretKeys.join(', ')} — `
      + `secrets live in the company .env, never in omega.json5`,
    );
  }

  const { brands, ...inheritable } = raw;
  return inheritable;
}

/**
 * Idempotently stamp `.omega/company.json` into a brand so its local runs
 * layer this company's defaults.
 *
 * @returns {boolean} - true when the marker was (re)written
 */
function stampCompanyMarker(brandRoot, companyRoot) {
  const markerPath = path.join(brandRoot, COMPANY_MARKER);
  const existing = jetpack.read(markerPath, 'json');

  if (existing?.root === companyRoot) {
    return false;
  }

  jetpack.write(markerPath, { root: companyRoot }, { jsonIndent: 2 });
  return true;
}

/**
 * Read a brand's company marker. null when absent (standalone brand);
 * `stale: true` when the marker points at something that is no longer a
 * company workspace.
 *
 * @returns {{ companyRoot: string, stale: boolean }|null}
 */
function readCompanyMarker(brandRoot) {
  const root = readCompanyRoot(brandRoot);
  if (!root) return null;

  return { companyRoot: root, stale: !isCompanyRoot(root) };
}

/**
 * Strip the leading verb (#229 — each child spawn names `manage` itself) and
 * the company-only flags from a raw argv, so the remainder forwards to
 * per-brand child processes verbatim (--brand/--concurrency take values in
 * both --flag=x and --flag x forms; --parallel is boolean).
 */
function filterChildArgs(rawArgv) {
  const argv = stripLeadingVerb(rawArgv);
  const VALUE_FLAGS = new Set(['--brand', '--concurrency']);
  const BOOLEAN_FLAGS = new Set(['--parallel']);
  const out = [];

  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].split('=')[0];

    if (BOOLEAN_FLAGS.has(name)) continue;
    if (VALUE_FLAGS.has(name)) {
      if (!argv[i].includes('=') && argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) {
        i++;
      }
      continue;
    }

    out.push(argv[i]);
  }

  return out;
}

module.exports = {
  DEFAULT_BRAND_ROOTS,
  readRawConfig,
  isCompanyRoot,
  resolveManageRoot,
  discoverBrands,
  loadCompanyConfig,
  stampCompanyMarker,
  readCompanyMarker,
  filterChildArgs,
};

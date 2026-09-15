/**
 * The company layer's ONE resolver
 * ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)).
 *
 * A brand joins its company with ONE typed key, outside `brand` (Ian
 * 2026-09-12: "brand key is for things about this brand, and the
 * parent/company/organization key is OUTSIDE of that"):
 *
 *   company: { id: 'itw-creative-works' }   // a sub-brand: the parent's brand.id
 *   company: { id: 'self' }                 // the company brand itself
 *
 * The resolver fills that SAME object at load (`{ id, name, url, images,
 * webhooks }`), so one name carries one shape at every level and no reader
 * needs a fallback: a brand with no `company` key resolves to `{ id: null,
 * name: brand.name, url: brand.url, images: {}, webhooks: true }`.
 *
 * `webhooks` is the one key beside `id` a brand TYPES (#677): `false` says the
 * provider ACCOUNT is somebody else's and the manage walk never repoints its
 * one account-level webhook. It is the brand's own statement, so it is read
 * from the brand config at every branch, never from the company.
 *
 * The COMPANY TREE is a `company/` folder INSIDE the parent brand's repo,
 * shaped like a brand (`company/config/omega.json5`, `company/.env`,
 * `company/.omega/certificates/apple/`). Inheritance is ONE rule: a
 * brand-level file the child lacks resolves from the parent's `company/` at the
 * same relative path, through `file(relPath)`. Everything that cascades (the
 * config chain in load.js, the .env chain in env.js, owner hooks in hooks.js,
 * the desktop signing tree) asks that one function, so a NEW kind of inherited
 * file costs zero code.
 *
 * WHERE the parent lives on this machine is a cache, never configuration: the
 * machine registry `~/.omega/brands.json` (`OMEGA_HOME` overrides the home),
 * keyed by `brand.id`, which every loadConfig() refreshes for its own brand.
 * Nobody maintains it, and a parent that has never been loaded here is simply
 * inheritance-off with one loud line.
 *
 * OFF-LAPTOP the tree never travels: the machine that dispatches a deploy
 * resolves the company and writes `config/company-resolved.json5` beside the
 * brand config (@omega.js/devkit's deploy snapshot), and a runner reads that
 * generated layer instead of a registry it has no lines in.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');

// The company TREE inside the parent brand's repo, and the file an off-laptop
// run reads the resolved layer from: GENERATED beside the brand config by the
// deploy snapshot, which is the only place a brand-wide generated file can sit
// and still ride a mirror (git cannot re-include a path under an excluded
// directory, and every brand ignores `.omega/` whole).
const COMPANY_DIR = 'company';
const COMPANY_RESOLVED_FILE = path.join('config', 'company-resolved.json5');

// The machine registry: brand id to { root, name, url, updatedAt }. One file,
// no other company-shaped state.
const REGISTRY_FILE = 'brands.json';

// `company: { id: 'self' }` is the company brand itself, kept visible on
// purpose (Ian 2026-09-12: "dont retire parent field for parent brands, i like
// it visible").
const SELF = 'self';

// The legacy stamp #677 retired, warned about where an owner still carries one.
const RETIRED_MARKER = path.join('.omega', 'company.json');

// One warning per company id per process: a missing parent is a state a whole
// build runs in, never a per-call event.
const warned = new Set();

/**
 * The machine home OMEGA keeps its per-machine state in. `OMEGA_HOME` moves it
 * (the test lanes point it at a temp dir so a fixture never writes a real line).
 * @returns {string} Absolute path.
 */
function omegaHome() {
  return process.env.OMEGA_HOME || path.join(os.homedir(), '.omega');
}

/**
 * The machine registry file.
 * @returns {string} Absolute path to `<home>/brands.json`.
 */
function registryFile() {
  return path.join(omegaHome(), REGISTRY_FILE);
}

/**
 * Parse a JSON/JSON5 file, tolerantly: this whole module is a CACHE plus a
 * parent's own public facts, and neither may ever fail a brand's load.
 * @param {string} file - Absolute path.
 * @returns {object|null} The parsed object, or null.
 */
function readJson(file) {
  try {
    const parsed = JSON5.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A brand root's authored omega.json5.
 * @param {string|null} root - Brand root.
 * @returns {object|null}
 */
function readBrandConfig(root) {
  return root ? readJson(path.join(root, 'config', 'omega.json5')) : null;
}

/**
 * The whole machine registry.
 * @returns {Object<string, { root: string, name: string, url: string, updatedAt: string }>}
 */
function readRegistry() {
  return readJson(registryFile()) || {};
}

/**
 * Record (or refresh) ONE brand's line in the machine registry, which is what
 * every `loadConfig()` does for the brand it just loaded: the map of where the
 * brands are on this machine maintains itself.
 *
 * IDEMPOTENT: a line whose root, name and url already match is left untouched
 * (`updatedAt` is not churn). It NEVER throws: a read-only home, a racing
 * writer, or a machine with no home directory at all is a registry that misses,
 * which is inheritance-off, never a failed load.
 *
 * A write also PRUNES the lines whose root is gone: the file is a map of what
 * is on this machine, so a brand that was deleted or moved (and re-recorded
 * under its new root) leaves nothing behind to resolve into.
 *
 * @param {object} entry - The brand's own facts.
 * @param {string} entry.id - `brand.id` (the key).
 * @param {string} entry.root - The brand root on this machine.
 * @param {string} [entry.name] - `brand.name`.
 * @param {string} [entry.url] - `brand.url`.
 * @returns {boolean} True when a line was written.
 */
function recordBrand({ id, root, name, url }) {
  if (!id || !root) return false;

  try {
    const registry = readRegistry();
    const current = registry[id];
    const line = { root, name: name || null, url: url || null };

    if (current && current.root === line.root && (current.name || null) === line.name && (current.url || null) === line.url) {
      return false;
    }

    registry[id] = { ...line, updatedAt: new Date().toISOString() };

    const live = Object.fromEntries(Object.entries(registry).filter(([, entry]) => entry && isDir(entry.root)));

    fs.mkdirSync(omegaHome(), { recursive: true });
    fs.writeFileSync(registryFile(), `${JSON.stringify(live, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The generated layer an off-laptop run reads: what the dispatching machine
 * resolved, written beside the brand config and carried by the deploy snapshot.
 * @param {string|null} brandRoot
 * @returns {{ config: object, company: object }|null}
 */
function readResolvedLayer(brandRoot) {
  const generated = brandRoot ? readJson(path.join(brandRoot, COMPANY_RESOLVED_FILE)) : null;
  return generated && generated.company ? generated : null;
}

/** A directory that is really there. */
function isDir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The one line a missing parent prints, once per company id per process.
 * @param {string} id
 */
function warnMissing(id) {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`Company ${id} is not on this machine: inheritance off. Clone it and run any omega verb inside it once.`);
}

/**
 * The company tree (`<root>/company`), when the root has one.
 * @param {string|null} root
 * @returns {string|null}
 */
function companyDir(root) {
  const dir = root ? path.join(root, COMPANY_DIR) : null;
  return dir && isDir(dir) ? dir : null;
}

/**
 * The wordmark a company hands its brands: the company brand's OWN wordmark.
 * @param {object} brand - A brand block.
 * @returns {{ wordmark?: string }}
 */
function wordmarkOf(brand) {
  const wordmark = brand && brand.images ? brand.images.wordmark : null;
  return wordmark ? { wordmark } : {};
}

/**
 * The resolver's answer, built around ONE inheritance rule.
 * @param {object} facts - The company's id/name/url/images/root, the brand's
 *   own `webhooks` statement, plus the generated layer's config when there is
 *   no tree to read one from.
 * @returns {object} The resolveCompany() shape.
 */
function answer({ id = null, name = null, url = null, images = {}, root = null, config = null, configFile = null, webhooks = true }) {
  const dir = companyDir(root);

  // The WHOLE inheritance rule: a brand-level file the child lacks resolves
  // from the parent's company/ at the same relative path. Nothing per-kind.
  const file = (relPath) => {
    const candidate = dir && relPath ? path.join(dir, relPath) : null;
    return candidate && fs.existsSync(candidate) ? candidate : null;
  };

  const layerFile = configFile || file(path.join('config', 'omega.json5'));

  return {
    id,
    name: name || null,
    url: url || null,
    images: images || {},
    // Typed boolean, default true: only an explicit `false` opts out.
    webhooks: webhooks !== false,
    root: root || null,
    dir,
    file,
    // The company CONFIG layer itself, already parsed: read from the parent's
    // company/config/omega.json5 here, handed over by the generated layer on a
    // runner.
    config: config || (layerFile ? readJson(layerFile) : null),
    configFile: layerFile || null,
  };
}

/**
 * The company a brand belongs to, filled from its typed `company.id`.
 *
 * @param {string} brandRoot - The brand (or standalone-project) root.
 * @param {object} [brandConfig] - The brand's authored config, when the caller
 *   already has it (loadConfig does); read from the brand root otherwise.
 * @returns {{ id: string|null, name: string|null, url: string|null, images: object, webhooks: boolean, root: string|null, dir: string|null, file: Function, config: object|null, configFile: string|null }}
 *   `root` is the parent brand's root ON THIS MACHINE (null = inheritance off),
 *   `file(relPath)` that path inside the parent's `company/` when it exists.
 */
function resolveCompany(brandRoot, brandConfig) {
  const root = brandRoot ? path.resolve(brandRoot) : null;
  const config = brandConfig || readBrandConfig(root) || {};
  const brand = config.brand || {};
  const id = config.company && typeof config.company.id === 'string' ? config.company.id.trim() : '';

  // The brand's OWN statement, on every branch: whose provider account the
  // manage walk may repoint (#677). Never the company's to answer.
  const webhooks = !(config.company && config.company.webhooks === false);
  const reply = (facts) => answer({ ...facts, webhooks });

  // A brand still carrying the retired stamp hears about it once: the folder it
  // points at is not read any more, by anything.
  if (root && fs.existsSync(path.join(root, RETIRED_MARKER)) && !warned.has(RETIRED_MARKER)) {
    warned.add(RETIRED_MARKER);
    console.warn(`${path.join(root, RETIRED_MARKER)} is retired (#677): delete it, and name the company with company: { id: '<parent brand.id>' } in omega.json5.`);
  }

  // No company: the brand IS the whole entity, so the company facts are its own
  // and every reader works without a fallback.
  if (!id) {
    return reply({ id: null, name: brand.name, url: brand.url });
  }

  // The company brand itself: its own company/ tree, its own public facts.
  if (id === SELF) {
    return reply({ id: SELF, name: brand.name, url: brand.url, images: wordmarkOf(brand), root });
  }

  const line = readRegistry()[id];
  const parentRoot = line && typeof line.root === 'string' && isDir(line.root) ? line.root : null;

  if (parentRoot) {
    const parentBrand = (readBrandConfig(parentRoot) || {}).brand || {};

    return reply({
      id,
      name: parentBrand.name || line.name,
      url: parentBrand.url || line.url,
      images: wordmarkOf(parentBrand),
      root: parentRoot,
    });
  }

  // Off this laptop: what the dispatching machine resolved rides beside the
  // brand config. Never a tree, so `file()` answers null for everything.
  const generated = readResolvedLayer(root);
  if (generated) {
    const company = generated.company || {};
    return reply({
      id: company.id || id,
      name: company.name,
      url: company.url,
      images: company.images || {},
      config: generated.config || {},
      configFile: path.join(root, COMPANY_RESOLVED_FILE),
    });
  }

  // A config that already CARRIES the facts: composeTargetConfig freezes the
  // resolved company into a target's upload (the deployed backend has no
  // registry, no company tree and no brand walk-up above it), so what the
  // dispatching machine resolved is the answer here. A human never authors
  // these keys: the loader refuses them in a brand file.
  const frozen = config.company || {};
  if (frozen.name || frozen.url || frozen.images) {
    return reply({ id, name: frozen.name, url: frozen.url, images: frozen.images || {} });
  }

  // Known in the registry but the folder is gone: the cached public facts still
  // stand, the tree does not.
  if (line) {
    return reply({ id, name: line.name, url: line.url });
  }

  warnMissing(id);
  return reply({ id });
}

module.exports = {
  resolveCompany,
  recordBrand,
  readRegistry,
  registryFile,
  COMPANY_DIR,
  COMPANY_RESOLVED_FILE,
  COMPANY_SELF: SELF,
};

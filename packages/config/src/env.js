/**
 * .env cascade — the secrets mirror of the omega.json5 hierarchy (D15).
 *
 * Weakest → strongest: company .env ← brand .env ← local .env ← shell.
 *
 * Same walk as the config cascade (load.js owns it): a target inside a brand
 * monorepo ({brand}/targets/{target}) layers the brand root's .env under its own,
 * and a brand stamped with .omega/company.json layers its company root's
 * .env underneath that. Loading uses dotenv's no-override semantics — keys
 * already in process.env (the shell) always win, and files apply
 * innermost-first, so local beats brand beats company.
 *
 * Secrets are DEFINED once at their source level (a brand-wide GH_TOKEN in
 * the brand .env, a company-wide key in the company .env) and RESOLVED here
 * at runtime/build. Only a target that physically ships an env file still
 * gets one materialized (dist/.env rides the Firebase deploy artifact —
 * composeTargetEnv below builds it from this same chain, on every verb).
 */

const fs = require('node:fs');
const path = require('node:path');

const { findBrandRoot } = require('./load.js');
const { readCompanyRoot } = require('./company.js');
const { ENV_SCHEMA, envFileGroups } = require('./env-schema.js');

/**
 * Resolve the .env chain for a project dir, strongest file first.
 *
 * `startDir` is the dir whose .env is the local layer — the project root for
 * web/desktop/extension, the functions dir for a backend (its .env rides
 * the deploy artifact). Brand discovery normalizes a target subdir (functions/,
 * dist/) → target root, same as the config loader.
 *
 * @param {string} startDir
 * @returns {{ local: string, brand: string|null, company: string|null }}
 *   Absolute .env paths (existence not checked here).
 */
function resolveEnvChain(startDir) {
  const targetDir = path.resolve(startDir);
  const brandRoot = findBrandRoot(targetDir);
  // The marker sits at the brand root; when startDir IS a brand root (no
  // targets/ walk above it), its own marker supplies the company layer.
  const companyRoot = readCompanyRoot(brandRoot || targetDir);

  return {
    local: path.join(targetDir, '.env'),
    brand: brandRoot ? path.join(brandRoot, '.env') : null,
    company: companyRoot ? path.join(companyRoot, '.env') : null,
  };
}

/**
 * Load an ordered list of .env files (strongest first) with dotenv's
 * no-override semantics: keys already in process.env (the shell, or a
 * stronger file) always win, so load order = precedence. Null/missing
 * entries skip silently.
 *
 * One rule on top of plain dotenv (dogfood friction #20): a file layer's
 * EMPTY value (`KEY=` / `KEY=""`) never claims the key — empty means
 * "documented here, value supplied by another layer", so a scaffolded
 * local .env full of placeholders can't shadow the brand root's real
 * values. Only the shell can deliberately set a key to empty.
 *
 * @param {Array<string|null>} envPaths
 * @returns {string[]} The files that existed and were loaded.
 */
function loadEnvChain(envPaths) {
  const loaded = [];

  for (const envPath of envPaths) {
    if (!envPath || !fs.existsSync(envPath)) continue;

    const parsed = require('dotenv').parse(fs.readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (value === '' || key in process.env) continue;
      process.env[key] = value;
    }

    loaded.push(envPath);
  }

  return loaded;
}

/**
 * Apply the schema's `deliverAs` renames to a value map, in place — the ONE
 * place the rename lives ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)).
 *
 * Per entry that carries `deliverAs` and names `target`: the brand-level name
 * (`GOOGLE_ANALYTICS_SECRET_WEB`) becomes the runtime name
 * (`GOOGLE_ANALYTICS_SECRET`) — a target only ever sees the one it reads, so
 * the source name is consumed. A value already sitting under the delivered
 * name WINS (the shell, or a human's explicit answer); the source name is
 * consumed either way.
 *
 * Backend rides it through composeTargetEnv's dist/.env; every other target
 * rides it through loadEnv, which delivers into process.env at CLI boot.
 *
 * @param {Object<string, string>} values - Mutated in place (a parsed layer, or process.env).
 * @param {string} target - Target name ('backend', 'web', …).
 * @returns {string[]} The delivered names that were set.
 */
function applyDeliverAs(values, target) {
  const delivered = [];

  for (const entry of ENV_SCHEMA) {
    if (!entry.deliverAs || !entry.targets.includes(target)) continue;

    const value = values[entry.name];
    delete values[entry.name];
    if (!value) continue;
    if (values[entry.deliverAs]) continue;

    values[entry.deliverAs] = value;
    delivered.push(entry.deliverAs);
  }

  return delivered;
}

/**
 * Resolve + load the full .env cascade for a project dir:
 * shell > local .env > brand .env > company .env.
 *
 * Pass the caller's `target` and the schema's `deliverAs` renames land in
 * process.env too — the web/desktop/extension half of the delivery the
 * backend gets from composeTargetEnv's dist/.env. Without a target nothing is
 * renamed.
 *
 * @param {string} startDir - See resolveEnvChain.
 * @param {object} [options]
 * @param {string} [options.target] - Target name ('web', 'desktop', …).
 * @returns {{ chain: { local: string, brand: string|null, company: string|null }, loaded: string[] }}
 */
function loadEnv(startDir, { target } = {}) {
  const chain = resolveEnvChain(startDir);
  const loaded = loadEnvChain([chain.local, chain.brand, chain.company]);
  if (target) applyDeliverAs(process.env, target);
  return { chain, loaded };
}

/**
 * Parse one .env file into a plain map. Missing files read as empty.
 *
 * @param {string|null} envPath
 * @returns {Object<string, string>} Parsed key → value.
 */
function parseEnvFile(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return {};

  return require('dotenv').parse(fs.readFileSync(envPath, 'utf8'));
}

/**
 * The schema entry that DELIVERS `key` to `target`, if any — an exact name
 * first, then the dynamic families' patterns (`envSchemaEntry`'s order). A key
 * is delivered only when its entry names the target AND its group renders into
 * a real file: the `file: false` groups are the backend's own resolution lanes
 * (config at boot, the developer's shell), never something a brand hands down.
 *
 * @param {string} key - The env var name in the brand/company layer.
 * @param {string} target - Target name ('backend', 'web', …).
 * @returns {object|undefined} The entry, or undefined when the key stays home.
 */
function deliveringEntry(key, target) {
  const fileGroups = new Set(envFileGroups().map((group) => group.id));
  const claims = (entry) => entry.targets.includes(target) && fileGroups.has(entry.group);

  return ENV_SCHEMA.find((entry) => entry.name === key && claims(entry))
    || ENV_SCHEMA.find((entry) => entry.match instanceof RegExp && entry.match.test(key) && claims(entry));
}

/**
 * Compose the env a target's own artifact ships with
 * ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)).
 *
 * FILES ONLY, never the shell: company .env ← brand .env ← target .env, the
 * same chain resolveEnvChain walks, strongest last. The brand root's .env is
 * the ONE file humans and the manager edit; a target's own .env is an optional
 * per-key override a human writes. Nothing here reads or writes process.env —
 * a build must produce the same artifact under any shell.
 *
 * The two brand-side layers are FILTERED by the env schema (the only filter
 * there is): a key rides down when some entry claims it — by name or by
 * pattern — names this target, and sits in a file group. The TARGET layer
 * passes through unfiltered: placing a key in the target's own .env IS the
 * targeting. `deliverAs` renames on arrival in EVERY layer (the per-target GA4
 * secrets), so a human writing the brand-level name in the target's own .env
 * gets the one delivered key, overriding the brand's.
 *
 * An empty value never claims a key, the same rule loadEnvChain applies: empty
 * means "documented here, valued by another layer".
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root (its .env is the local layer).
 * @param {string} options.target - Target name ('backend', 'web', …).
 * @returns {{ values: Object<string, string>, sources: Object<string, string> }}
 *   `sources` maps each delivered key to the layer it came from
 *   (`company`/`brand`/`target`) — for logging by key NAME only.
 */
function composeTargetEnv({ targetDir, target }) {
  const chain = resolveEnvChain(targetDir);
  const values = {};
  const sources = {};

  const deliver = (key, value, layer) => {
    if (!value) return;
    values[key] = value;
    sources[key] = layer;
  };

  // Weakest first — each layer overwrites what the one below it delivered
  for (const layer of ['company', 'brand']) {
    const claimed = {};
    for (const [key, value] of Object.entries(parseEnvFile(chain[layer]))) {
      if (!deliveringEntry(key, target)) continue;
      claimed[key] = value;
    }

    applyDeliverAs(claimed, target);
    for (const [key, value] of Object.entries(claimed)) {
      deliver(key, value, layer);
    }
  }

  const local = parseEnvFile(chain.local);
  applyDeliverAs(local, target);
  for (const [key, value] of Object.entries(local)) {
    deliver(key, value, 'target');
  }

  return { values, sources };
}

/**
 * Serialize one value as a double-quoted .env line — the serializer SSOT every
 * writeback rides (this composer, the manager's brand .env writeback and
 * scaffold stub). Backslashes, quotes and newlines escape so a multi-line blob
 * stays line-safe (dotenv expands `\n` back on read).
 *
 * @param {string} key - Env var name.
 * @param {string} value - Value to serialize.
 * @returns {string} `KEY="value"`.
 */
function envLine(key, value) {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');

  return `${key}="${escaped}"`;
}

/**
 * Serialize composed values as .env content — one envLine per key.
 *
 * @param {Object<string, string>} values
 * @returns {string} The file content, newline-terminated.
 */
function serializeEnv(values) {
  const lines = Object.entries(values).map(([key, value]) => envLine(key, value));

  return `${lines.join('\n')}\n`;
}

module.exports = { loadEnv, resolveEnvChain, loadEnvChain, applyDeliverAs, composeTargetEnv, envLine, serializeEnv };

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
 * Every layer is TWO files, not one
 * ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)): its `.env` and
 * the `.env.<environment>` overlay that wins over it — the widespread standard
 * (Next.js, Vite, Rails dotenv, dotenv-flow). The environment names are exactly
 * what envEnvironment() returns, so there is ONE vocabulary between the file
 * name and the runtime's own answer, and only the RUNNING environment's overlay
 * is ever read. Every key is equal: whatever the overlay holds wins, values are
 * trusted, no key gets special treatment.
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

// The ONE environment vocabulary, strongest signal first: every `.env.<name>`
// overlay is suffixed with one of these, every framework's environment() answers
// one of these, and nothing anywhere spells a fourth
// ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)).
const ENV_ENVIRONMENTS = ['development', 'testing', 'production'];

/**
 * The runtime environment — the SINGLE SOURCE OF TRUTH for the one vocabulary,
 * shared by the env overlay above and by every framework's own environment
 * answer (@omega.js/backend's `env.environment()` / `Manager.getEnvironment()`
 * delegate here). Exactly ONE of three mutually-exclusive values: testing wins,
 * then production, else development.
 *
 * The final `else` is PRODUCTION on purpose: a deployed Cloud Function has no
 * FUNCTIONS_EMULATOR and often no ENVIRONMENT var, so "no signal" IS the normal
 * production state. Defaulting to development would make every deployed
 * function skip real side effects (emails/analytics/webhooks). (Contrast
 * UJM/BXM, whose deployed artifacts always carry their signal.)
 *
 * @returns {'testing'|'production'|'development'} The environment.
 */
function envEnvironment() {
  // Testing takes precedence — set by the test runner / emulator (OMEGA_TEST_MODE=true).
  if (process.env.OMEGA_TEST_MODE === 'true') {
    return 'testing';
  }
  if (process.env.ENVIRONMENT === 'production') {
    return 'production';
  } else if (
    process.env.ENVIRONMENT === 'development'
    || process.env.FUNCTIONS_EMULATOR === true
    || process.env.FUNCTIONS_EMULATOR === 'true'
    || process.env.TERM_PROGRAM === 'Apple_Terminal'
    || process.env.TERM_PROGRAM === 'vscode'
  ) {
    return 'development';
  } else {
    return 'production';
  }
}

/**
 * The files ONE layer of the chain contributes, WEAKEST first: its `.env`, then
 * the `.env.<environment>` overlay that wins over it (#586). A layer with no
 * path contributes nothing; existence is not checked here.
 *
 * @param {string|null} envPath - The layer's base .env path.
 * @param {string} [environment] - The running environment; absent = base only.
 * @returns {string[]} Absolute paths, weakest first.
 */
function envLayerFiles(envPath, environment) {
  if (!envPath) return [];

  return environment ? [envPath, `${envPath}.${environment}`] : [envPath];
}

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

// Key OWNERSHIP, remembered instead of inferred
// ([#724](https://github.com/Omega-JS-Stack/omega/issues/724)). The no-override
// rule below is what makes the shell win, but after a boot load EVERY key is
// "already in process.env", so presence alone can no longer tell a shell value
// from a file value — which is why a reload used to have to skip edits. Two
// sets keep the answer: what process.env carried BEFORE this process read its
// first file (shell-owned, forever), and what a file layer has put there since
// (file-owned, the only keys reloadEnv may drop and re-read).
let shellOwnedKeys = null;
const fileOwnedKeys = new Set();

/**
 * Record a key a file layer just delivered into process.env (#724).
 *
 * A key the shell brought stays shell-owned even if something deleted it and a
 * file layer then supplied it — reloadEnv must never rewrite one.
 *
 * @param {string} key
 */
function markFileOwned(key) {
  if (!shellOwnedKeys.has(key)) fileOwnedKeys.add(key);
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
  // The first chain load in the process fixes the shell-owned set: nothing here
  // has read a file yet, so whatever process.env carries came from outside (#724)
  if (shellOwnedKeys === null) shellOwnedKeys = new Set(Object.keys(process.env));

  const loaded = [];

  for (const envPath of envPaths) {
    if (!envPath || !fs.existsSync(envPath)) continue;

    const parsed = require('dotenv').parse(fs.readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (value === '' || key in process.env) continue;
      process.env[key] = value;
      markFileOwned(key);
    }

    loaded.push(envPath);
  }

  return loaded;
}

/**
 * Load the .env cascade for a list of LAYER ROOTS, strongest root first: each
 * root's `.env` plus the `.env.<environment>` overlay that wins over it (#586).
 *
 * The known-layers counterpart of loadEnv, which starts from a target dir and
 * DISCOVERS its chain. The manager's walks already know theirs — the brand
 * root, then the company root under it — and only need them loaded in order;
 * a null root (a standalone brand's missing company layer) skips.
 *
 * @param {Array<string|null>} roots - Layer roots, strongest first.
 * @param {object} [options]
 * @param {string} [options.environment] - The environment whose overlay applies
 *   (defaults to the running one).
 * @returns {string[]} The files that existed and were loaded.
 */
function loadEnvRoots(roots, { environment = envEnvironment() } = {}) {
  // Strongest first, so a layer's overlay is offered before its own base
  return loadEnvChain(roots.flatMap((root) => envLayerFiles(root && path.join(root, '.env'), environment).reverse()));
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
 * shell > local .env > brand .env > company .env, each layer's
 * `.env.<environment>` overlay winning over its own `.env` (#586).
 *
 * Pass the caller's `target` and the schema's `deliverAs` renames land in
 * process.env too — the web/desktop/extension half of the delivery the
 * backend gets from composeTargetEnv's dist/.env. Without a target nothing is
 * renamed.
 *
 * @param {string} startDir - See resolveEnvChain.
 * @param {object} [options]
 * @param {string} [options.target] - Target name ('web', 'desktop', …).
 * @param {string} [options.environment] - The environment whose overlay applies
 *   (defaults to the running one).
 * @returns {{ chain: { local: string, brand: string|null, company: string|null }, loaded: string[] }}
 */
function loadEnv(startDir, { target, environment = envEnvironment() } = {}) {
  const chain = resolveEnvChain(startDir);
  // Strongest first, so a layer's overlay is offered before its own base
  const files = ['local', 'brand', 'company']
    .flatMap((layer) => envLayerFiles(chain[layer], environment).reverse());
  const loaded = loadEnvChain(files);
  // A delivered name INHERITS its source key's ownership (#724): it carries a
  // file layer's value under a second key, so it is normally file-owned too —
  // otherwise an edited source value could not reach it. But the rename CONSUMES
  // the source key, so once the shell exported that source name, the delivered
  // name is the only place the shell's value still lives; calling it file-owned
  // would let a reload drop it (gone when no file declares the source, replaced
  // by the file's value when one does).
  if (target) {
    const shellSourced = new Set(ENV_SCHEMA
      .filter((entry) => entry.deliverAs && entry.targets.includes(target) && shellOwnedKeys.has(entry.name))
      .map((entry) => entry.deliverAs));

    for (const key of applyDeliverAs(process.env, target)) {
      // Inheritance is the whole answer, so a shell-sourced delivery also CLEARS
      // a file-owned mark an earlier load left on that name
      if (shellSourced.has(key)) fileOwnedKeys.delete(key);
      else markFileOwned(key);
    }
  }
  return { chain, loaded };
}

/**
 * Re-read the .env cascade for a project dir so EDITED file values land
 * ([#724](https://github.com/Omega-JS-Stack/omega/issues/724)) — the reload
 * half of loadEnv, same arguments, same answer.
 *
 * loadEnv alone cannot honor an edit: its no-override rule sees the key the
 * boot load put there and skips it. So this DROPS every file-owned key first —
 * the ones a file layer delivered, never one the shell brought — and then runs
 * the same load. Consequences, all of them the file being re-read rather than
 * merged onto the old set:
 *   - an EDITED value lands, and so does a NEW key;
 *   - a key DROPPED from the file is dropped from the process;
 *   - a SHELL-set key is untouched, whatever any file now says.
 *
 * It re-reads the chain it is GIVEN, so a process that loaded several projects'
 * cascades keeps only the reloaded one's file keys. The dev lanes' `.env`
 * watchers (#681) are the caller, and each watches its own single target.
 *
 * @param {string} startDir - See resolveEnvChain.
 * @param {object} [options] - See loadEnv.
 * @param {string} [options.target] - Target name ('web', 'desktop', …).
 * @param {string} [options.environment] - The environment whose overlay applies.
 * @returns {{ chain: { local: string, brand: string|null, company: string|null }, loaded: string[] }}
 */
function reloadEnv(startDir, { target, environment = envEnvironment() } = {}) {
  for (const key of fileOwnedKeys) delete process.env[key];
  fileOwnedKeys.clear();

  return loadEnv(startDir, { target, environment });
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
 * Each layer is its `.env` plus the `.env.<environment>` overlay that wins over
 * it (#586), so ONE flat artifact ships for ONE environment: a deploy composes
 * base + production, the emulator base + development, a test lane base + testing
 * — and no other environment's file ever rides along.
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
 * @param {string} [options.environment] - The environment whose overlay composes
 *   (defaults to the running one).
 * @returns {{ values: Object<string, string>, sources: Object<string, string> }}
 *   `sources` maps each delivered key to the layer it came from
 *   (`company`/`brand`/`target`) — an overlay reports as its own layer, for
 *   logging by key NAME only.
 */
function composeTargetEnv({ targetDir, target, environment = envEnvironment() }) {
  const chain = resolveEnvChain(targetDir);
  const values = {};
  const sources = {};

  const deliver = (key, value, layer) => {
    if (!value) return;
    values[key] = value;
    sources[key] = layer;
  };

  // Weakest first — each file overwrites what the ones below it delivered, and
  // a layer's overlay sits directly above its own base
  const files = [
    ...envLayerFiles(chain.company, environment).map((file) => ({ file, layer: 'company', filtered: true })),
    ...envLayerFiles(chain.brand, environment).map((file) => ({ file, layer: 'brand', filtered: true })),
    // The TARGET layer passes through unfiltered: placement IS the targeting
    ...envLayerFiles(chain.local, environment).map((file) => ({ file, layer: 'target', filtered: false })),
  ];

  for (const { file, layer, filtered } of files) {
    const claimed = {};
    for (const [key, value] of Object.entries(parseEnvFile(file))) {
      if (filtered && !deliveringEntry(key, target)) continue;
      claimed[key] = value;
    }

    applyDeliverAs(claimed, target);
    for (const [key, value] of Object.entries(claimed)) {
      deliver(key, value, layer);
    }
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

module.exports = { loadEnv, reloadEnv, ENV_ENVIRONMENTS, envEnvironment, resolveEnvChain, envLayerFiles, loadEnvChain, loadEnvRoots, applyDeliverAs, composeTargetEnv, envLine, serializeEnv };

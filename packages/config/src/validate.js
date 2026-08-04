/**
 * Schema-driven validation for resolved omega.json5 configs.
 *
 * The rule walker (runSchema) is electron-manager's proven validate-config
 * engine ported verbatim: required/type/match/enum semantics, where match +
 * enum only run on PRESENT values and a conditional `required` function
 * receives the full config. See schema.js for the rule format.
 *
 * validateConfig() layers on top of the walker:
 *   - SHARED_SCHEMA always runs; TARGET_SCHEMAS[options.target] adds that
 *     target's refinements against the same resolved top-level namespace
 *   - `targets` sanity: unknown target names are errors (typo protection —
 *     targets.website is a mistake, the canonical name is web) and each
 *     present entry must be an object ({} = enabled with defaults) OR an
 *     array of id'd instance entries (multi-instance targets: ids required,
 *     dir-safe, unique per type; >1 backend instance is a WARNING)
 *   - `cloud.config.authDomain`, when set, must be the brand's OWN host (the
 *     resolved instance url, else brand.url): a firebaseapp.com value or a
 *     mismatch is an error, and demo-* (emulator-only) projects are exempt
 *   - retired keys are always errors (see retired-keys.js) — a name that was
 *     renamed outright reads as nothing at all, so it fails loudly instead of
 *     losing its settings silently
 *   - secret-shaped keys are always errors (see secrets.js) — loadConfig
 *     additionally hard-fails on them before any merge happens
 */

const { TARGETS, SHARED_SCHEMA, TARGET_SCHEMAS } = require('./schema.js');
const { findSecretKeys } = require('./secrets.js');
const { findRetiredKeys } = require('./retired-keys.js');
const { isPlainObject } = require('./merge.js');
const { INSTANCE_ID_PATTERN } = require('./instances.js');
const { isDemoProject } = require('./demo.js');

// Firebase's own default authDomain shape: a third-party host by definition
const FIREBASE_AUTH_DOMAIN = /\.firebaseapp\.com$/;

function getPath(obj, dottedPath) {
  if (!obj) return undefined;
  const parts = String(dottedPath).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function isPresent(v) {
  if (v == null) return false;
  if (typeof v === 'string' && v.length === 0) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
  return true;
}

/**
 * Walk a config object against a schema array and collect human-readable errors.
 * @param {object} config - The (resolved) config object.
 * @param {object[]} schema - Rule array in the schema.js entry format.
 * @returns {string[]} Errors; empty when the config passes.
 */
function runSchema(config, schema) {
  const errors = [];

  for (const rule of schema) {
    const value = getPath(config, rule.path);
    const present = isPresent(value);

    // ─── Required check ─────────────────────────────────────────────────────
    let isRequired = false;
    if (typeof rule.required === 'function') {
      // A throwing required() is a broken first-party schema rule — report
      // it loud instead of silently treating the field as optional
      try { isRequired = !!rule.required(config); }
      catch (e) {
        errors.push(`config.${rule.path} required() threw: ${e.message}`);
        continue;
      }
    } else {
      isRequired = !!rule.required;
    }

    if (!present) {
      if (isRequired) {
        const why = rule.description ? ` — ${rule.description}` : '';
        errors.push(`config.${rule.path} is required${why}`);
      }
      // Absent + not required → nothing else to check.
      continue;
    }

    // ─── Type check ('|' unions allowed: 'string|boolean') ──────────────────
    if (rule.type) {
      const matches = (type) => {
        switch (type) {
          case 'string':  return typeof value === 'string';
          case 'boolean': return typeof value === 'boolean';
          case 'number':  return typeof value === 'number' && Number.isFinite(value);
          case 'integer': return Number.isInteger(value);
          case 'array':   return Array.isArray(value);
          case 'object':  return isPlainObject(value);
          default:        return true;
        }
      };
      if (!rule.type.split('|').some(matches)) {
        errors.push(`config.${rule.path} has wrong type — got ${Array.isArray(value) ? 'array' : typeof value}, expected ${rule.type}`);
        continue;          // skip secondary checks if the type is wrong
      }
    }

    // ─── Min check (numbers) ────────────────────────────────────────────────
    if (typeof rule.min === 'number' && typeof value === 'number' && value < rule.min) {
      const why = rule.description ? ` — ${rule.description}` : '';
      errors.push(`config.${rule.path} ${value} is below the minimum ${rule.min}${why}`);
    }

    // ─── Match check (strings) ──────────────────────────────────────────────
    if (rule.match && typeof value === 'string' && !rule.match.test(value)) {
      const why = rule.description ? ` — ${rule.description}` : '';
      errors.push(`config.${rule.path} "${value}" does not match expected pattern ${rule.match}${why}`);
    }

    // ─── Enum check ─────────────────────────────────────────────────────────
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push(`config.${rule.path} "${value}" is not allowed — must be one of [${rule.enum.join(', ')}]`);
    }
  }

  return errors;
}

/**
 * The host this (resolved) config's brand lives on. An instance entry's own
 * `url` is already merged to the top level by the target chain, and it wins
 * over the brand-shared `brand.url`, the same precedence
 * instances.resolveInstanceUrl uses.
 * @param {object} config - The resolved config object.
 * @returns {string} The lowercase hostname, or '' when no URL is known.
 */
function resolvedBrandHost(config) {
  const url = getPath(config, 'url') || getPath(config, 'brand.url');

  if (typeof url !== 'string' || !url) {
    return '';
  }

  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

/**
 * authDomain must be the brand's OWN host (cp268). Firebase's default
 * `<project>.firebaseapp.com` is a third-party host: under browser storage
 * partitioning its redirect sign-in loses the session, which is why the web
 * build self-hosts Firebase's `/__/auth/*` helper files on the brand domain.
 *
 * demo-* projects are exempt because they are emulator-only (no real GCP project
 * exists), so no redirect sign-in ever leaves the emulator.
 * @param {object} config - The resolved config object.
 * @returns {string[]} Errors; empty when the config passes.
 */
function validateAuthDomain(config) {
  const authDomain = getPath(config, 'cloud.config.authDomain');

  if (typeof authDomain !== 'string' || !authDomain.trim()) {
    return [];
  }

  if (isDemoProject(getPath(config, 'cloud.config.projectId'))) {
    return [];
  }

  const value = authDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  if (FIREBASE_AUTH_DOMAIN.test(value)) {
    return [
      `config.cloud.config.authDomain "${authDomain}" is a firebaseapp.com domain, but it must be this brand's own host, `
      + `which self-hosts /__/auth/* so redirect sign-in survives browser storage partitioning `
      + `(docs/shared/config.md → "authDomain is the brand's own host")`,
    ];
  }

  const brandHost = resolvedBrandHost(config);

  // No URL anywhere: nothing to compare against, and brand.url is optional
  if (!brandHost || value === brandHost) {
    return [];
  }

  return [
    `config.cloud.config.authDomain "${authDomain}" is not this brand's host "${brandHost}": `
    + `authDomain must be the host the site is served from, which self-hosts /__/auth/* `
    + `(docs/shared/config.md → "authDomain is the brand's own host")`,
  ];
}

/**
 * Validate a resolved config: shared schema + optional target refinements +
 * targets-key sanity + secret-shaped-key detection.
 * @param {object} config - The resolved config object.
 * @param {object} [options]
 * @param {string} [options.target] - Canonical target name; adds TARGET_SCHEMAS[target].
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateConfig(config, options) {
  options = options || {};

  if (options.target && !TARGETS.includes(options.target)) {
    throw new Error(`Unknown target "${options.target}" — must be one of [${TARGETS.join(', ')}]`);
  }

  const schema = options.target
    ? [...SHARED_SCHEMA, ...TARGET_SCHEMAS[options.target]]
    : SHARED_SCHEMA;

  const errors = runSchema(config, schema);
  const warnings = [];

  // ─── targets sanity ────────────────────────────────────────────────────
  const targets = config ? config.targets : undefined;
  if (isPlainObject(targets)) {
    Object.keys(targets).forEach((key) => {
      if (!TARGETS.includes(key)) {
        errors.push(`config.targets.${key} is not a known target — must be one of [${TARGETS.join(', ')}]`);
        return;
      }

      const entry = targets[key];

      // Multi-instance array form: every entry MUST carry a unique dir-safe
      // id (it names the apps/<canonical>-<id> dir). Backend stays single-
      // instance in practice — >1 is a warning, not an error (spec v1).
      if (Array.isArray(entry)) {
        if (entry.length === 0) {
          errors.push(`config.targets.${key} instance array must not be empty — use {} for a single default instance`);
          return;
        }

        const seen = new Set();
        entry.forEach((instance, index) => {
          if (!isPlainObject(instance)) {
            errors.push(`config.targets.${key}[${index}] must be an instance object — got ${Array.isArray(instance) ? 'array' : typeof instance}`);
            return;
          }
          if (typeof instance.id !== 'string' || !INSTANCE_ID_PATTERN.test(instance.id)) {
            errors.push(`config.targets.${key}[${index}] must carry a dir-safe id (lowercase, starts with a letter, alnum/-) — it names apps/<dir>-<id>`);
            return;
          }
          if (seen.has(instance.id)) {
            errors.push(`config.targets.${key} instance id "${instance.id}" is not unique — ids must be unique per target type`);
          }
          seen.add(instance.id);
        });

        if (key === 'backend' && entry.length > 1) {
          warnings.push(`config.targets.backend has ${entry.length} instances — multi-instance backend is unsupported for now (Cloud Functions = one project surface per brand)`);
        }
        return;
      }

      if (!isPlainObject(entry)) {
        errors.push(`config.targets.${key} must be an object ({} = enabled with defaults) or an array of id'd instances — got ${typeof entry}`);
      }
    });
  }

  // ─── authDomain is the brand's own host (cp268) ────────────────────────
  validateAuthDomain(config).forEach((error) => errors.push(error));

  // ─── retired keys (#142) ───────────────────────────────────────────────
  findRetiredKeys(config).forEach(({ path, replacement, why }) => {
    errors.push(
      `config.${path} is retired — the key is now "${replacement}" (${why}). `
      + `Rename it; there is no dual-read, so the old name is silently ignored `
      + `(docs/shared/config.md → "Migration — legacy configs")`,
    );
  });

  // ─── secrets ───────────────────────────────────────────────────────────
  findSecretKeys(config).forEach((keyPath) => {
    errors.push(`config.${keyPath} looks like a secret — secrets live in .env, never in omega.json5`);
  });

  return { errors, warnings };
}

// Render a numbered, human-readable error block. Used by callers that want to
// throw a single Error with all problems collected.
function formatErrors(errors) {
  if (!errors.length) return '';
  return errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
}

module.exports = { validateConfig, runSchema, formatErrors };

/**
 * Schema-driven validation for resolved omega.json5 configs.
 *
 * The rule walker (runSchema) is electron-manager's proven validate-config
 * engine ported verbatim: required/type/match/enum semantics, where match +
 * enum (and itemEnum, the same check per member of an array value) only run on
 * PRESENT values and a conditional `required` function
 * receives the full config. See schema.js for the rule format.
 *
 * validateConfig() layers on top of the walker:
 *   - SHARED_SCHEMA always runs; TARGET_SCHEMAS[options.target] adds that
 *     target's refinements against the same resolved top-level namespace
 *   - `targets` sanity (#886): every key is a target NAME, so it must be a
 *     dir-safe slug, and every entry must be an object declaring a `type` the
 *     framework list knows (an ARRAY is the retired multi-instance form, whose
 *     replacement is a sibling key; >1 backend target is a WARNING)
 *   - the `repo` block (#883): one `provider` from REPO_PROVIDERS, and an `org`
 *     that is a real non-empty string whenever the block is there, because the
 *     org is the owner of every repo the brand's names derive under
 *   - `hosting` (#883) is a WEB target's key: a non-web target carrying it says
 *     something nothing serves, and its provider comes from HOSTING_PROVIDERS
 *   - `cloud.config.authDomain`, when set, must be the brand's OWN host (the
 *     resolved target url, else brand.url): a firebaseapp.com value or a
 *     mismatch is an error, and demo-* (emulator-only) projects are exempt
 *   - retired keys are always errors (see retired-keys.js) — a name that was
 *     renamed outright reads as nothing at all, so it fails loudly instead of
 *     losing its settings silently
 *   - secret-shaped keys are always errors (see secrets.js) — loadConfig
 *     additionally hard-fails on them before any merge happens
 *   - keys the schema does not declare are WARNINGS (#636): the walker only
 *     ever visits declared paths, so a typo — or a live path nobody declared —
 *     used to pass in silence
 */

const { TARGETS, SHARED_SCHEMA, TARGET_SCHEMAS } = require('./schema.js');
const { findSecretKeys } = require('./secrets.js');
const { findRetiredKeys } = require('./retired-keys.js');
const { isPlainObject } = require('./merge.js');
const { TARGET_NAME_PATTERN, TARGET_TYPES } = require('./targets.js');
const { REPO_PROVIDERS, HOSTING_PROVIDERS } = require('./repo.js');
const { isDemoProject } = require('./demo.js');
const { isCountedFeature } = require('@omega.js/account/features');

// Firebase's own default authDomain shape: a third-party host by definition
const FIREBASE_AUTH_DOMAIN = /\.firebaseapp\.com$/;

/**
 * Read a dotted path out of a config object — the path resolver the schema
 * walk and the env presence checker (env-rules.js) share.
 *
 * @param {object} obj - The (resolved) config object.
 * @param {string} dottedPath - e.g. 'analytics.providers.google.id'.
 * @returns {*} The value, or undefined when any segment is missing.
 */
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

    // ─── Max check (numbers) ────────────────────────────────────────────────
    if (typeof rule.max === 'number' && typeof value === 'number' && value > rule.max) {
      const why = rule.description ? ` — ${rule.description}` : '';
      errors.push(`config.${rule.path} ${value} is above the maximum ${rule.max}${why}`);
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

    // ─── Item enum check (arrays) ───────────────────────────────────────────
    // A LIST of allowed values (the extension's AMO categories): every member
    // is named on its own line, so one bad slug in a good list is the one the
    // error points at.
    if (rule.itemEnum && Array.isArray(value)) {
      for (const item of value) {
        if (!rule.itemEnum.includes(item)) {
          errors.push(`config.${rule.path} "${item}" is not allowed: must be one of [${rule.itemEnum.join(', ')}]`);
        }
      }
    }
  }

  return errors;
}

/**
 * The host this (resolved) config's BRAND lives on, which is a brand-level
 * fact and never a per-target one (#588, Ian 2026-09-01): one Firebase project,
 * one backend, one persona domain, shared by every target a brand runs. So
 * `brand.url` answers first and the top-level `url` (the target's own public
 * url, derived from its name or declared on its entry) is only the fallback for
 * a config that carries no brand.url at all. Reading them the other way round
 * made a `targets/admin` load fail its own brand's authDomain check and seeded
 * personas at a different domain than the backend's.
 * @param {object} config - The resolved config object.
 * @returns {string} The lowercase hostname, or '' when no URL is known.
 */
function resolvedBrandHost(config) {
  const url = getPath(config, 'brand.url') || getPath(config, 'url');

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
 * The repo block and the hosting key (#883).
 *
 * `repo` is `{ provider, org }` and nothing else: its PRESENCE enables the repo
 * service, and every repo name derives from `<brand.id>-<role>`, so the org is
 * the whole address. A block with no usable org is the failure this catches
 * loudly, because every derivation would otherwise answer null and each reader
 * would skip in its own quiet way.
 *
 * `hosting` says where a WEB target is served from. Only a web target has a
 * built site to serve, so the key on any other type is a statement nothing
 * reads. The targets map rides every resolved config, so this check answers the
 * same on a raw config and on a target-resolved one.
 *
 * @param {object} config - The resolved config object.
 * @returns {string[]} Errors; empty when the config passes.
 */
function validateRepo(config) {
  const errors = [];
  const repo = config ? config.repo : undefined;

  if (isPlainObject(repo)) {
    if (repo.provider !== undefined && !REPO_PROVIDERS.includes(repo.provider)) {
      errors.push(`config.repo.provider ${JSON.stringify(repo.provider)} is not a host OMEGA builds for: one of [${REPO_PROVIDERS.join(', ')}]`);
    }

    if (typeof repo.org !== 'string' || !repo.org.trim()) {
      errors.push(
        'config.repo.org is required when the repo block is present: it is the org every repo the brand owns lives in '
        + '(`<brand.id>-omega`, `<brand.id>-releases`, `<brand.id>-<web target>`), and no repo name is configurable anywhere',
      );
    }
  }

  const targets = config ? config.targets : undefined;
  if (!isPlainObject(targets)) return errors;

  Object.entries(targets).forEach(([name, entry]) => {
    if (!isPlainObject(entry) || entry.hosting === undefined) return;

    if (entry.type !== 'web') {
      errors.push(`config.targets.${name}.hosting is a web-target key: a ${JSON.stringify(entry.type)} target has no built site to serve`);
      return;
    }

    const provider = isPlainObject(entry.hosting) ? entry.hosting.provider : undefined;
    if (provider !== undefined && !HOSTING_PROVIDERS.includes(provider)) {
      errors.push(`config.targets.${name}.hosting.provider ${JSON.stringify(provider)} is not a host OMEGA builds for: one of [${HOSTING_PROVIDERS.join(', ')}]`);
    }
  });

  return errors;
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
 * The features catalog and the values each product names against it (#647).
 *
 * A feature is defined ONCE, at the top level, and a product names only its
 * VALUE — which means the two halves have to agree or the promise a page
 * renders is fiction. Three ways they can disagree, each an error:
 *   - a value on an id the catalog does not define reads as NOTHING (the same
 *     silence a retired key used to buy), so the row simply vanishes;
 *   - a NUMBER on a perk claims a meter that will never count, and the account
 *     page would draw a usage bar against a limit no gate enforces;
 *   - a PERK value (true / a string) on a counted feature leaves the gate with
 *     no number, which reads as zero — the plan advertises the feature and
 *     every call refuses it.
 * Plus the catalog's own shape: an entry needs the `name` every surface
 * prints, and a `usage` block only pages by day or not at all.
 *
 * `false` is legal on ANY feature: the tier does not include it, counted or
 * not, which is what an absent value means too.
 *
 * @param {object} config - The resolved config object.
 * @returns {string[]} Errors; empty when the config passes.
 */
function validateFeatures(config) {
  const errors = [];
  const catalog = config ? getPath(config, 'features') : undefined;

  if (isPresent(catalog) && !isPlainObject(catalog)) {
    return [`config.features must be a map of feature id → definition — got ${Array.isArray(catalog) ? 'array' : typeof catalog}`];
  }

  const entries = isPlainObject(catalog) ? catalog : {};

  Object.entries(entries).forEach(([id, entry]) => {
    if (!isPlainObject(entry)) {
      errors.push(`config.features.${id} must be an object — { name, icon, definition, usage? }`);
      return;
    }

    if (typeof entry.name !== 'string' || !entry.name.trim()) {
      errors.push(`config.features.${id}.name is required — it is the label every surface prints (pricing rows, comparison matrix, account usage bars)`);
    }

    if (entry.usage === undefined) {
      return;
    }

    if (!isPlainObject(entry.usage)) {
      errors.push(`config.features.${id}.usage must be an object — { pace: 'daily' | false, mirror: ['<doc kind>'] }; omit it entirely to make ${id} a perk`);
      return;
    }

    if (entry.usage.pace !== undefined && entry.usage.pace !== 'daily' && entry.usage.pace !== false) {
      errors.push(
        `config.features.${id}.usage.pace must be 'daily' (the default) or false — a month limit is either spread over the days of the month or spent whenever the user likes`,
      );
    }

    if (entry.usage.mirror !== undefined
      && (!Array.isArray(entry.usage.mirror) || entry.usage.mirror.some((kind) => typeof kind !== 'string'))) {
      errors.push(`config.features.${id}.usage.mirror must be an array of document kinds — e.g. ['teams']`);
    }
  });

  const products = config ? getPath(config, 'payment.products') : undefined;

  if (!Array.isArray(products)) {
    return errors;
  }

  products.forEach((product, index) => {
    const values = isPlainObject(product) ? product.features : undefined;
    const label = `config.payment.products[${index}] (${(product && product.id) || 'unnamed'})`;

    if (Array.isArray(values)) {
      errors.push(
        `${label} features must be a map of values, not a list (#647) — `
        + `write \`features: { saves: 100, support: true }\` and define each feature ONCE in the top-level \`features\` catalog`,
      );
      return;
    }

    if (values === undefined || values === null) {
      return;
    }

    if (!isPlainObject(values)) {
      errors.push(`${label} features must be a map of feature id → value — got ${typeof values}`);
      return;
    }

    Object.entries(values).forEach(([id, value]) => {
      const entry = entries[id];

      if (!entry) {
        errors.push(
          `${label} names the feature "${id}", which the top-level features catalog does not define — `
          + `add it to \`features\` (nothing reads a value with no definition behind it)`,
        );
        return;
      }

      // Not included is not a claim: `false` says so on any kind of feature.
      if (value === false) {
        return;
      }

      if (isCountedFeature(entry)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(
            `${label} gives "${id}" the value ${JSON.stringify(value)}, but ${id} is a counted feature `
            + `(it carries a \`usage\` block) — its value is the MONTHLY limit as a number, or -1 for unlimited`,
          );
        }
        return;
      }

      if (typeof value === 'number') {
        errors.push(
          `${label} gives "${id}" the number ${value}, but ${id} is not a counted feature `
          + `(no \`usage\` block in the catalog) — give it true or a string, or add \`usage: {}\` to \`features.${id}\` to meter it`,
        );
      }
    });
  });

  return errors;
}

/**
 * The LEAF paths of a resolved config the schema does not declare (#636).
 *
 * A rule declares its own path AND everything beneath it — an `object`/`array`
 * rule is a declared subtree (brand.address's postal fields, an open provider
 * map), which is what keeps a brand's own data out of this list. An empty
 * object/array is itself a leaf, declared when the schema declares anything
 * below it (`certificates: {}` against certificates.enabled).
 *
 * The `targets` subtree is skipped whole: those keys belong to a framework or,
 * for a custom target (#603), to the brand — the targets-sanity check above is
 * what polices that namespace.
 *
 * @param {object} config - The resolved config object.
 * @param {object[]} schema - Rule array in the schema.js entry format.
 * @returns {string[]} Undeclared leaf paths, in config order.
 */
function findUndeclaredPaths(config, schema) {
  const declared = schema.map((rule) => rule.path);
  const found = [];

  const walk = (value, path) => {
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      Object.keys(value).forEach((key) => walk(value[key], `${path}.${key}`));
      return;
    }
    if (!declared.some((rule) => rule === path || path.startsWith(`${rule}.`) || rule.startsWith(`${path}.`))) {
      found.push(path);
    }
  };

  Object.keys(isPlainObject(config) ? config : {})
    .filter((key) => key !== 'targets')
    .forEach((key) => walk(config[key], key));

  return found;
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
    const backends = [];

    Object.keys(targets).forEach((key) => {
      const entry = targets[key];

      // The key is a NAME, and the name is the folder (targets/<name>), so it
      // has to be a dir-safe slug (#886).
      if (!TARGET_NAME_PATTERN.test(key)) {
        errors.push(`config.targets.${key} is not a usable target name (lowercase, starts with a letter, alnum/-): the name IS the folder targets/${key}`);
        return;
      }

      if (Array.isArray(entry)) {
        errors.push(`config.targets.${key} is an array; a second instance is a sibling key, see docs/shared/breaking-changes.md 2026-09-11`);
        return;
      }

      if (!isPlainObject(entry)) {
        errors.push(`config.targets.${key} must be an object declaring its type, got ${typeof entry}`);
        return;
      }

      // The TYPE says which framework runs there, and nothing else does: a
      // name no framework owns is a deliberate brand choice, never a typo to
      // guess at, so the type is what every reader keys off.
      if (!TARGET_TYPES.includes(entry.type)) {
        errors.push(
          `config.targets.${key} must declare \`type\`, one of [${TARGET_TYPES.join(', ')}]`
          + `${entry.type === undefined ? '' : ` (got ${JSON.stringify(entry.type)})`}`,
        );
        return;
      }

      if (entry.type === 'backend') backends.push(key);
    });

    // Backend stays single-target in practice (one Cloud Functions surface per
    // brand), so more than one is a warning, not an error.
    if (backends.length > 1) {
      warnings.push(`config.targets declares ${backends.length} backend targets (${backends.join(', ')}): multiple backends are unsupported for now (Cloud Functions = one project surface per brand)`);
    }
  }

  // ─── the repo block, and where a web target is hosted (#883) ───────────
  validateRepo(config).forEach((error) => errors.push(error));

  // ─── authDomain is the brand's own host (cp268) ────────────────────────
  validateAuthDomain(config).forEach((error) => errors.push(error));

  // ─── the winback offer is ONE shape (#268) ─────────────────────────────
  // A coupon is percent-based or amount-based everywhere in the payment stack,
  // and the schema walker checks fields one at a time, so the pair rule lives
  // here. Two shapes on one offer has no honest reading — a provider would
  // have to pick — so it fails the config instead.
  const winback = config ? getPath(config, 'payment.winback') : undefined;
  if (isPlainObject(winback) && typeof winback.percent === 'number' && typeof winback.amount === 'number') {
    errors.push('config.payment.winback sets both percent and amount — a save offer is one shape or the other, never both');
  }

  // ─── a product price has ONE spelling (#674) ───────────────────────────
  // Every reader takes the bare number: the intent route's confirmation URL,
  // all three provider libraries' resolvePrice(), the checkout page's own
  // summary math. The checkout's resolvers ALSO unwrapped `{ amount: N }`, so
  // an object-shaped price rendered a real total on the page and put
  // `[object Object]` in the confirmation URL's `amount` — the two sides
  // disagreeing about the same catalog entry. There is no shared resolver to
  // put the shape in (the browser bundle cannot reach a build-time package, and
  // the deployed backend does not carry one either), so the shape is settled
  // HERE, in the one place both sides' catalog comes from.
  const products = config ? getPath(config, 'payment.products') : undefined;
  if (Array.isArray(products)) {
    products.forEach((product, index) => {
      const prices = isPlainObject(product) ? product.prices : undefined;

      if (!isPlainObject(prices)) {
        return;
      }

      Object.entries(prices).forEach(([key, value]) => {
        if (typeof value !== 'number') {
          errors.push(
            `config.payment.products[${index}] (${product.id || 'unnamed'}) price "${key}" must be a number `
            + `— write \`${key}: 9.99\`, never \`${key}: { amount: 9.99 }\` (the two sides do not read the object shape the same)`,
          );
        }
      });
    });
  }

  // ─── the features catalog and the values products name (#647) ──────────
  validateFeatures(config).forEach((error) => errors.push(error));

  // ─── undeclared paths (#636) ───────────────────────────────────────────
  // A warning, never an error: a brand config outliving one framework version
  // must still build, and the finding is what closes the gap — either the key
  // is dead, or the schema owes it a rule.
  const undeclared = findUndeclaredPaths(config, schema);
  if (undeclared.length > 0) {
    warnings.push(
      'config carries keys the schema does not declare — nothing reads them, so a typo looks exactly like a '
      + `feature. Remove them, or give each one a rule in @omega.js/config's schema.js `
      + `(docs/shared/config.md → Validation): ${undeclared.join(', ')}`,
    );
  }

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

module.exports = { validateConfig, runSchema, formatErrors, getPath, resolvedBrandHost };

/**
 * The `.env` → GitHub Actions secrets publisher, once, for every target that
 * publishes plain string secrets
 * ([#627](https://github.com/Omega-JS-Stack/omega/issues/627) review).
 *
 * Web built it first (#189) and the extension needed the same thing (#680), so
 * for one wave there were two near-byte-identical copies — same five skip
 * cases, same declared-repo guard, same `gh` transport, same wording. This is
 * the ONE copy; each framework binds it with its own target string and nothing
 * else.
 *
 *   1. DERIVE: the KEY SET is @omega.js/config'sONE delivery primitive, read
 *      off the schema AND the composed values (`publishSecretKeys(target,
 *      { values })`): every entry whose `delivery` names the target, plus the
 *      `match` family members this brand actually configured
 *      ([#876](https://github.com/Omega-JS-Stack/omega/issues/876)) and the
 *      keys the schema does not know at all, a consumer's own
 *      ([#835](https://github.com/Omega-JS-Stack/omega/issues/835)). Still not
 *      "whatever the composed .env holds": a declared key this target does not
 *      deliver, and every `machineLocal` one, stay home.
 *   2. COLLECT — the VALUES come from the target's COMPOSED env
 *      (`composeTargetEnv`, [#678](https://github.com/Omega-JS-Stack/omega/issues/678)):
 *      company ← brand ← target `.env`, the brand-side layers schema-filtered
 *      to the keys that target reads with `deliverAs` applied (a brand's
 *      GOOGLE_ANALYTICS_SECRET_WEB arrives as GOOGLE_ANALYTICS_SECRET). FILES
 *      only — the shell is never a source, so CI gets what the brand's files
 *      say under any shell. `machineLocal` keys (#454) need no filter here: the
 *      schema drops them from the delivered set itself.
 *   3. GUARD — secrets belong to the repo whose Actions run the workflow, and
 *      the only acceptable proof of which repo that is, is the brand's own
 *      config (`repo.org`, the SOURCE repo). An inferred git remote is not proof: a
 *      target vendored into a framework/test monorepo, a cloned starter still
 *      pointing at the template author, or any fork would publish this brand's
 *      `.env` to a stranger's Actions. A checkout that could be the brand's own
 *      and whose origin names another repo REFUSES on `repoDrift`'s one line
 *      ([#934](https://github.com/Omega-JS-Stack/omega/issues/934)), the
 *      same refusal the deploy lane and the manage walk make.
 *   4. PUBLISH — each collected key becomes a repo Actions secret via devkit's
 *      `gh` boundary (values on stdin, never logged).
 *
 * Every skip is LOUD (a line, never silence). A missing/signed-out `gh` is NOT
 * a skip — it throws the boundary's instructions (install, `gh auth login`, or
 * `omega deploy --no-secrets`).
 *
 * A key the SCHEMA says this target's config requires (`required` /
 * `requiredWhen`, @omega.js/config's env-rules) and the cascade resolves EMPTY
 * stops the publish outright ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)):
 * the run that reads those secrets is the one that signs a release, and half a
 * signing set on a runner is a green build nobody can install. Nothing is
 * pushed on that path, so the fix and the re-run are one step, not a partial
 * state to reason about. A key that is merely absent and NOT required gets one
 * line naming it.
 *
 * There is no per-framework BIND any more
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): the four files
 * that passed a target string and a seam were four places to forget a rule, and
 * the standalone `omega push-secrets` verb they backed is gone with them. The
 * seams live HERE, in one table keyed by target type, and every caller (each
 * framework's deploy precheck, the manager's repo walk) makes the same call.
 *
 *   desktop  `resolveValue` base64-encodes a secret that names a FILE
 *            (#682: `CSC_LINK` points at a `.p12` and CI needs the bytes), and
 *            `deriveValues` fills the signing paths from the signing tree, by
 *            the ONE derivation the desktop env load runs
 *            (`@omega.js/devkit/signing-env`), so no operator pastes a path.
 *   backend  `extraSecrets`: the deploy credential is a service-account FILE
 *            the cloud manage service mints (#872), so there is nothing in the
 *            cascade to compose it from and it arrives already valued.
 *   web, extension  plain strings, no seam.
 *
 * `dryRun` ([#895](https://github.com/Omega-JS-Stack/omega/issues/895)) prints
 * the key NAMES that would publish, the derived lines and any refusal, and
 * sends nothing. The refusal still THROWS in a dry run: a plan that cannot be
 * made is loud.
 */
const { composeTargetEnv, loadConfig, sourceRepo } = require('@omega.js/config');
const { publishSecretKeys } = require('@omega.js/config/env-delivery');
const { checkEnvRules } = require('@omega.js/config/env-rules');
const { publishActionsSecrets } = require('./actions-secrets.js');
const { assertOriginMatches } = require('./git-remote.js');
const { findBrandRoot } = require('./local.js');
const { targetSeams } = require('./target-seams.js');

/**
 * The target's COMPOSED env, with the bind's own derivations applied to it.
 *
 * PRODUCTION, named rather than sniffed: these values fuel the runner's release
 * build, and the composer would otherwise default to whatever environment this
 * shell happens to be
 * ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)): the same
 * determinism the "FILES only, never the shell" rule above buys.
 *
 * Everything that reads the cascade reads it through HERE (the required-key
 * check and the collection both), so a derived value is as real as a typed one
 * to each of them ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @param {string} options.target - Target name.
 * @param {function} [options.deriveValues] - The derive seam (see collectTargetSecrets).
 * @param {object} [options.logger] - `{ log, warn, error }`; each derivation prints one line.
 * @returns {{ values: object, fixes: Object<string, string> }}
 */
function composeValues({ targetDir, target, deriveValues, logger }) {
  const { values } = composeTargetEnv({ targetDir, target, environment: 'production' });

  const { derived = [], fixes = {} } = (deriveValues ? deriveValues(values) : null) || {};
  for (const { key, value } of derived) {
    if (logger) logger.log(`${key} derived from ${value}`);
  }

  return { values, fixes };
}

/**
 * The publishable secrets for a target: the delivery set the ONE primitive
 * answers for it (schema names, family members, the consumer's own keys),
 * valued from the same composed env the set is read off. An empty value never
 * claims a key.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root (its .env is the local layer).
 * @param {string} options.target - Target name ('web', 'extension', …).
 * @param {function} [options.resolveValue] - `(value, key) => string`, the seam
 *   applied to each collected value before it travels (desktop base64-encodes
 *   its file-path signing secrets). A falsy return DROPS the key, exactly as an
 *   empty composed value does.
 * @param {function} [options.deriveValues] - `(values) => { derived, fixes }`, the
 *   seam applied to the COMPOSED map before anything reads it: a bind may VALUE
 *   a key the cascade left empty (desktop derives its signing paths from the
 *   dispersed artifacts) and may name, per key it could NOT value, the fix line
 *   the refusal should carry. `derived` is `[{ key, value }]` (already written
 *   into the map); `fixes` is `key → sentence`.
 * @returns {Object<string, string>} key → value, ready to publish.
 */
function collectTargetSecrets(options) {
  const { targetDir, target, logger } = options;
  const seams = targetSeams({ target, targetDir });
  const resolveValue = 'resolveValue' in options ? options.resolveValue : seams.resolveValue;
  const deriveValues = 'deriveValues' in options ? options.deriveValues : seams.deriveValues;
  const { values } = composeValues({ targetDir, target, deriveValues, logger });

  const secrets = {};
  // The key set and the values come from ONE composition (#835, #876): a
  // family member or a consumer's own key exists only in the composed map, so
  // the set has to be read off the same map it is valued from.
  for (const key of publishSecretKeys(target, { values })) {
    if (!values[key]) {
      // Never silence: a key with no value in the cascade is a key CI will not
      // have. Whether that MATTERS is the schema's answer, below.
      if (logger) logger.log(`No value for ${key} in the .env cascade: not published`);
      continue;
    }
    const value = resolveValue ? resolveValue(values[key], key) : values[key];
    if (value) secrets[key] = value;
  }

  return secrets;
}

/**
 * The keys this target's own config REQUIRES that the cascade cannot value.
 *
 * The rules are the schema's, evaluated by the ONE checker (#626) against the
 * target's resolved config and its COMPOSED env, narrowed to the keys this
 * publisher would send: a required key CI never reads is not the publish's
 * business, and a rule nobody delivers cannot be fixed by pushing anything.
 *
 * The bind's derivations run FIRST (`deriveValues`), because a key the brand
 * never typed but the dispersed files answer is not missing, and a key the
 * derivation could not value carries that seam's own fix line
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @param {string} options.target - Target name.
 * @param {function} [options.deriveValues] - The derive seam (see collectTargetSecrets).
 * @returns {Array<{ key: string, rule: string, path: string|null, fix: string|null }>}
 */
function missingRequiredSecrets(options) {
  const { targetDir, target } = options;
  const deriveValues = 'deriveValues' in options
    ? options.deriveValues
    : targetSeams({ target, targetDir }).deriveValues;

  let config;
  try {
    // PRODUCTION, the same environment `composeValues` composes for: the rules
    // and the values have to be read off ONE config, or a developer machine's
    // `config/omega.development.json5` decides whether a release publish
    // refuses ([#895](https://github.com/Omega-JS-Stack/omega/issues/895)).
    config = loadConfig(targetDir, target, { environment: 'production' }).config;
  } catch (e) {
    // No loadable config: there is no declaration to owe anything to.
    return [];
  }

  const { values, fixes } = composeValues({ targetDir, target, deriveValues });
  const delivered = new Set(publishSecretKeys(target, { values }));

  return checkEnvRules(config, values, { target })
    .filter((violation) => delivered.has(violation.key))
    .map((violation) => ({ ...violation, fix: fixes[violation.key] || null }));
}

/**
 * The target's resolved PRODUCTION config, like every other read this publish
 * makes (#895): the repo a release's secrets belong to is the one the
 * production config names. Null when it doesn't load.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @param {string} options.target - Target name ('web', 'extension', …).
 * @returns {object|null}
 */
function productionConfig(options) {
  try {
    return loadConfig(options.targetDir, options.target, { environment: 'production' }).config || null;
  } catch (e) {
    return null;
  }
}

/**
 * The `omega deploy` precheck: publish the target's collected `.env` values as
 * repo Actions secrets.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @param {string} options.target - Target name ('web', 'extension', …).
 * @param {object} options.logger - `{ log, warn, error }`.
 * @param {object} [options.env] - Env map (default: process.env).
 * @param {boolean} [options.dryRun] - Print the plan (key NAMES, the derived
 *   lines, any refusal) and send nothing (#895).
 * @param {function} [options.resolveValue] - Value seam override (tests).
 * @param {function} [options.deriveValues] - Derive seam override (tests).
 * @param {Object<string, string>} [options.extraSecrets] - Override for the
 *   target's already-valued keys, merged OVER the composed set (tests).
 * @param {function} [options.execFn] - Injectable `gh` exec (tests).
 * @returns {{ skipped: string }|{ planned: string[] }|{ published: string[], failed: Array<object> }}
 */
function publishTargetSecrets(options) {
  options = options || {};
  const { targetDir, target, logger, dryRun } = options;
  const env = options.env || process.env;

  // The target type's own shape differences, in ONE table (#891). A caller
  // passes a seam only to stub it.
  const seams = targetSeams({ target, targetDir });
  const resolveValue = 'resolveValue' in options ? options.resolveValue : seams.resolveValue;
  const deriveValues = 'deriveValues' in options ? options.deriveValues : seams.deriveValues;
  const extraSecrets = 'extraSecrets' in options ? options.extraSecrets : seams.extraSecrets;

  // CI runs the generated workflow as its build/publish step — the secrets
  // already exist there and the runner token can't write them.
  if (env.GITHUB_ACTIONS === 'true' || env.CI === 'true') {
    logger.log('Skipping secret publication — CI already has the repo secrets');
    return { skipped: 'ci' };
  }

  // The schema's set, plus the caller's own already-valued keys. An extra has
  // no `.env` home to compose from (backend's deploy credential is a FILE the
  // firebase service mints, #872), so it arrives valued and travels verbatim:
  // `resolveValue` is the COMPOSED half's seam and would only mangle it. An
  // empty extra claims no key, exactly as an empty composed value does.
  // The config's OWN requirements first: a half set is never published (#891)
  const missing = missingRequiredSecrets({ targetDir, target, deriveValues });
  if (missing.length > 0) {
    // ONE line shape per key, whatever answers it: `<KEY> (required by <path>):
    // <the fix>`. A key a bind can DERIVE names the producer that delivers the
    // file (`omega manage --service certificates`, then disperse) instead of
    // asking for a path to paste; everything else names the .env to set.
    const lines = missing.map(({ key, path, fix }) => {
      const detail = fix || `set it in the ${target} target's .env or the brand's, then re-run.`;

      return `  ${key}${path ? ` (required by ${path})` : ''}: ${detail}`;
    });
    throw new Error(
      `${missing.length} secret(s) this brand's config requires are empty in the .env cascade (company/brand/target). `
      + `Nothing was published.\n${lines.join('\n')}`,
    );
  }

  const secrets = { ...collectTargetSecrets({ targetDir, target, resolveValue, deriveValues, logger }) };
  for (const [key, value] of Object.entries(extraSecrets || {})) {
    if (value) secrets[key] = value;
  }

  const keys = Object.keys(secrets);
  if (!keys.length) {
    logger.warn('Skipping secret publication — no keys composed for this target from the .env cascade (company/brand/target)');
    return { skipped: 'no-secrets' };
  }

  const config = productionConfig({ targetDir, target });
  const source = config ? sourceRepo(config) : null;
  if (!source) {
    logger.warn('Skipping secret publication: this brand names no GitHub repo in config (repo.org). Set it, then re-run `omega deploy`.');
    return { skipped: 'no-declared-repo' };
  }

  // The ONE origin gate the deploy lane and the manage walk use
  // ([#934](https://github.com/Omega-JS-Stack/omega/issues/934)): the brand
  // root's own origin (the local remote, which the boot prelude has already
  // healed onto GitHub's redirect) must BE the derived source repo, or the
  // publish REFUSES on the one drift line, because arming a repo that is not
  // the derived one is the harm itself. No `.git` AT the brand root is nothing
  // to compare: a NESTED brand's remote is the enclosing repo's by
  // construction, and its deploy pushes to the derived repo regardless
  // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)). A checkout
  // with no GitHub origin (nobody pushed it yet, or it is hosted elsewhere) has
  // no repo to arm, so it skips.
  const origin = assertOriginMatches({ dir: findBrandRoot(targetDir), config });
  if (origin.reason === 'no-origin' || origin.reason === 'foreign-remote') {
    logger.warn(`Skipping secret publication: no GitHub remote here (${origin.reason})`);
    return { skipped: 'no-remote' };
  }

  const repo = source.slug;

  // The PLAN, and nothing else (#895): what the composition answered, by NAME.
  // It runs after the refusal and the two guards above on purpose, so a dry run
  // is a real preview of whether the deploy would publish at all: every one of
  // them is a READ, and a plan naming keys the real run would skip is a promise
  // the deploy cannot keep.
  if (dryRun) {
    logger.log(`DRY RUN, would publish ${keys.length} secret(s) for ${target}: ${keys.join(', ')}`);
    return { planned: keys };
  }

  logger.log(`Publishing ${keys.length} secret(s) to ${repo}: ${keys.join(', ')}`);

  const result = publishActionsSecrets({ repo, secrets, logger, execFn: options.execFn });
  logger.log(`Published ${result.published.length}/${keys.length} secret(s) to ${repo}`);

  return result;
}

module.exports = { collectTargetSecrets, missingRequiredSecrets, publishTargetSecrets };

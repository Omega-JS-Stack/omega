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
 *   1. DERIVE — the KEY SET is the env schema's: every entry whose `delivery`
 *      names the target (`publishSecretKeys(target)`, @omega.js/config). Never
 *      "whatever the composed .env holds", which published a brand's unrelated
 *      keys to a runner.
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
 *      config (`repo.providers.github`). An inferred git remote is not proof: a
 *      target vendored into a framework/test monorepo, a cloned starter still
 *      pointing at the template author, or any fork would publish this brand's
 *      `.env` to a stranger's Actions.
 *   4. PUBLISH — each collected key becomes a repo Actions secret via devkit's
 *      `gh` boundary (values on stdin, never logged).
 *
 * Every skip is LOUD (a line, never silence). A missing/signed-out `gh` is NOT
 * a skip — it throws the boundary's instructions (install, `gh auth login`, or
 * `omega deploy --no-secrets`).
 *
 * Desktop binds it too ([#682](https://github.com/Omega-JS-Stack/omega/issues/682)),
 * over the `resolveValue` seam: its signing secrets are named by PATH in the
 * cascade (`CSC_LINK=config/certs/dev-id.p12`) and what CI needs is the FILE, so
 * it base64-encodes an existing file between COLLECT and PUBLISH. That seam is
 * the only shape difference between the three binds — the transport is one.
 *
 * Backend binds it too ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)),
 * over a second seam: `extraSecrets`, already-valued keys with no `.env` home at
 * all. Its deploy credential is a service-account FILE the firebase manage
 * service mints, so there is nothing in the cascade to compose it from, and the
 * runner still needs it as a repo secret like everything else.
 */
const { composeTargetEnv } = require('@omega.js/config');
const { publishSecretKeys } = require('@omega.js/config/env-delivery');
const { publishActionsSecrets } = require('./actions-secrets.js');
const { resolveRepo, resolveDeployLane } = require('./deploy.js');

/**
 * The publishable secrets for a target: the schema's delivery set for it,
 * valued from the composed env. An empty value never claims a key.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root (its .env is the local layer).
 * @param {string} options.target - Target name ('web', 'extension', …).
 * @param {function} [options.resolveValue] - `(value, key) => string`, the seam
 *   applied to each collected value before it travels (desktop base64-encodes
 *   its file-path signing secrets). A falsy return DROPS the key, exactly as an
 *   empty composed value does.
 * @returns {Object<string, string>} key → value, ready to publish.
 */
function collectTargetSecrets(options) {
  const { targetDir, target, resolveValue } = options;
  // PRODUCTION, named rather than sniffed: these values fuel the runner's
  // release build, and the composer would otherwise default to whatever
  // environment this shell happens to be
  // ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)) — the same
  // determinism the "FILES only, never the shell" rule above buys.
  const { values } = composeTargetEnv({ targetDir, target, environment: 'production' });

  const secrets = {};
  for (const key of publishSecretKeys(target)) {
    if (!values[key]) continue;
    const value = resolveValue ? resolveValue(values[key], key) : values[key];
    if (value) secrets[key] = value;
  }

  return secrets;
}

/**
 * The brand's OWN repo as `owner/name`, from the target's resolved config — the
 * same derivation `omega deploy --direct` uses (`repo.providers.github`, name
 * falling back to brand.id). Null when the config declares nothing usable or
 * doesn't load.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @param {string} options.target - Target name ('web', 'extension', …).
 * @returns {string|null}
 */
function declaredBrandRepo(options) {
  try {
    const { loadConfig, brandRepoOwner, brandRepoName } = require('@omega.js/config');
    const { config } = loadConfig(options.targetDir, options.target);
    if (!config) return null;

    const owner = brandRepoOwner(config);
    const name = brandRepoName(config);
    return owner && name ? `${owner}/${name}` : null;
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
 * @param {function} [options.resolveValue] - Value seam (see collectTargetSecrets).
 * @param {Object<string, string>} [options.extraSecrets] - Already-valued keys
 *   that have no `.env` home, merged OVER the composed set.
 * @param {function} [options.execFn] - Injectable `gh` exec (tests).
 * @param {function} [options.gitExecFn] - Injectable `git` exec for remote discovery (tests).
 * @returns {{ skipped: string }|{ published: string[], failed: Array<object> }}
 */
function publishTargetSecrets(options) {
  options = options || {};
  const { targetDir, target, logger } = options;
  const env = options.env || process.env;

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
  const secrets = { ...collectTargetSecrets({ targetDir, target, resolveValue: options.resolveValue }) };
  for (const [key, value] of Object.entries(options.extraSecrets || {})) {
    if (value) secrets[key] = value;
  }

  const keys = Object.keys(secrets);
  if (!keys.length) {
    logger.warn('Skipping secret publication — no keys composed for this target from the .env cascade (company/brand/target)');
    return { skipped: 'no-secrets' };
  }

  const declared = declaredBrandRepo({ targetDir, target });
  if (!declared) {
    logger.warn('Skipping secret publication — this brand names no GitHub repo in config (repo.providers.github). Set it, then re-run `omega deploy`.');
    return { skipped: 'no-declared-repo' };
  }

  // A NESTED brand (its root is not the toplevel of the git repo it sits in)
  // has a remote that answers the ENCLOSING repo by construction, and its
  // deploy pushes a snapshot to the DECLARED repo regardless
  // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)), so the
  // mismatch guard would only ever skip a publish that is correct. Every other
  // guard stays: what the guard protects against is a checkout that COULD have
  // been the brand's own and is not.
  const { nested } = resolveDeployLane({ dir: targetDir, execFn: options.gitExecFn });
  const repo = declared;

  if (!nested) {
    let remote;
    try {
      const { owner, repo: name } = resolveRepo({ cwd: targetDir, execFn: options.gitExecFn });
      remote = `${owner}/${name}`;
    } catch (e) {
      logger.warn(`Skipping secret publication — no GitHub remote here (${e.message})`);
      return { skipped: 'no-remote' };
    }

    if (declared.toLowerCase() !== remote.toLowerCase()) {
      logger.warn(`Skipping secret publication — the git remote here is ${remote}, but this brand's repo is ${declared}. Run \`omega deploy\` from the brand's own checkout.`);
      return { skipped: 'repo-mismatch' };
    }
  }

  logger.log(`Publishing ${keys.length} secret(s) to ${repo}: ${keys.join(', ')}`);

  const result = publishActionsSecrets({ repo, secrets, logger, execFn: options.execFn });
  logger.log(`Published ${result.published.length}/${keys.length} secret(s) to ${repo}`);

  return result;
}

module.exports = { collectTargetSecrets, declaredBrandRepo, publishTargetSecrets };

/**
 * The `.env` → GitHub Actions secrets publisher for the backend target
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * A BIND of `@omega.js/devkit/target-secrets`, exactly as web, desktop and the
 * extension are: the same derive (the schema's backend delivery set) → collect
 * (the COMPOSED target env, company ← brand ← target, files only) → guard (the
 * brand's DECLARED repo, never an inferred remote) → publish, over the ONE `gh`
 * transport, with the same loud skips.
 *
 * Backend was the one target with no precheck, because its deploy ran from the
 * CLI with the brand's own files under it. The deploy runs on a RUNNER now, and
 * a runner has neither the `.env` nor the service-account key, so both have to
 * travel as repo secrets: the workflow writes the target's `.env` from the
 * generated env block, and `OMEGA_SERVICE_ACCOUNT_JSON` back to the key file
 * `firebase deploy` authenticates with.
 *
 * What is backend's OWN is that second key: it names no value in any `.env`
 * (a service-account key is a FILE, minted once by the firebase manage service
 * into the brand's `.omega/secrets/`), so it is collected from the authored
 * chain instead, through `resolveServiceAccountPath`: the same reader the stage
 * uses to carry the key into `dist/`.
 */
const jetpack = require('fs-jetpack');

const { collectTargetSecrets, declaredBrandRepo: declaredRepoFor, publishTargetSecrets } = require('@omega.js/devkit/target-secrets');
const { resolveServiceAccountPath } = require('./stage-functions');

const TARGET = 'backend';

// The env schema's name for the deploy credential (`delivery: { backend: 'ci' }`):
// the service-account JSON itself, which the workflow writes back to disk.
const SERVICE_ACCOUNT_KEY = 'OMEGA_SERVICE_ACCOUNT_JSON';

/**
 * The service-account secret, valued from the authored key chain (target root,
 * then the brand's `.omega/secrets/`). An absent key publishes nothing: a brand
 * that has not minted one yet deploys from a runner that cannot authenticate,
 * and the missing secret is what says so.
 *
 * @param {string} targetDir - The target root.
 * @returns {Object<string, string>} The one-key map, or an empty one.
 */
function serviceAccountSecret(targetDir) {
  const keyPath = resolveServiceAccountPath(targetDir);
  const contents = keyPath ? jetpack.read(keyPath) : null;

  return contents ? { [SERVICE_ACCOUNT_KEY]: contents } : {};
}

/**
 * The publishable secrets: the schema's backend delivery set valued from the
 * composed env, plus the service-account key from its own chain.
 *
 * @param {string} targetDir - The target root (its .env is the local layer).
 * @returns {Object<string, string>} key → value, ready to publish.
 */
function collectEnvSecrets(targetDir) {
  return { ...collectTargetSecrets({ targetDir, target: TARGET }), ...serviceAccountSecret(targetDir) };
}

/**
 * The brand's OWN repo as `owner/name`, from the composed config. Null when the
 * config declares nothing usable or doesn't load.
 *
 * @param {string} targetDir - The target root.
 * @returns {string|null}
 */
function declaredBrandRepo(targetDir) {
  return declaredRepoFor({ targetDir, target: TARGET });
}

/**
 * The `omega deploy` precheck step: publish the target's composed values, and
 * the service-account key, as repo Actions secrets.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @param {object} options.logger - `{ log, warn, error }`.
 * @param {object} [options.env] - Env map (default: process.env).
 * @param {function} [options.execFn] - Injectable `gh` exec (tests).
 * @param {function} [options.gitExecFn] - Injectable `git` exec for remote discovery (tests).
 * @returns {{ skipped: string }|{ published: string[], failed: Array<object> }}
 */
function publishEnvSecrets(options) {
  options = options || {};

  return publishTargetSecrets({
    ...options,
    target: TARGET,
    // The service-account key has no composed value to resolve, so it rides the
    // publisher's extra-secrets seam rather than its `resolveValue` one.
    extraSecrets: serviceAccountSecret(options.targetDir),
  });
}

module.exports = {
  collectEnvSecrets,
  declaredBrandRepo,
  publishEnvSecrets,
  serviceAccountSecret,
  SERVICE_ACCOUNT_KEY,
};

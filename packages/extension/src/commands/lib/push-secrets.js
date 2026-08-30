/**
 * The `.env` → GitHub Actions secrets publisher for the extension target
 * ([#680](https://github.com/Omega-JS-Stack/omega/issues/680)).
 *
 * The publish workflow is dispatched with no `.env` on the runner, so every
 * store credential and the baked Measurement Protocol secret reach the build
 * as repo Actions secrets — and until now nothing PUT them there: a consumer
 * pasted each one into the GitHub UI by hand, and a fresh brand's first publish
 * failed on whichever one they missed. `omega deploy` now pushes them, exactly
 * as web does.
 *
 * "Exactly as web does" is now literal: the derive → collect → guard → publish
 * orchestration is `@omega.js/devkit/target-secrets`, and this file is the
 * BIND — the target string and nothing else. Extension secrets are plain
 * strings, so there is no file/base64 lane here; that is desktop's, for its
 * signing certificates.
 */
const { collectTargetSecrets, declaredBrandRepo: declaredRepoFor, publishTargetSecrets } = require('@omega.js/devkit/target-secrets');

const TARGET = 'extension';

/**
 * The publishable secrets: the schema's extension delivery set, valued from
 * the composed env. An empty value never claims a key.
 *
 * @param {string} targetDir - The target root (its .env is the local layer).
 * @returns {Object<string, string>} key → value, ready to publish.
 */
function collectEnvSecrets(targetDir) {
  return collectTargetSecrets({ targetDir, target: TARGET });
}

/**
 * The brand's OWN repo as `owner/name`, from the composed config. Null when
 * the config declares nothing usable or doesn't load.
 *
 * @param {string} targetDir - The target root.
 * @returns {string|null}
 */
function declaredBrandRepo(targetDir) {
  return declaredRepoFor({ targetDir, target: TARGET });
}

/**
 * The `omega deploy` precheck step: publish the target's composed values as
 * repo Actions secrets.
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
  return publishTargetSecrets({ ...(options || {}), target: TARGET });
}

module.exports = { collectEnvSecrets, declaredBrandRepo, publishEnvSecrets };

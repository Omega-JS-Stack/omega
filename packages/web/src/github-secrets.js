/**
 * The `.env` → GitHub Actions secrets pair (#189), UJM's setup capability
 * rebuilt on the OMEGA cascade — and, since the #627 review, web's BIND of the
 * shared publisher rather than its own copy of it.
 *
 * The orchestration (derive the schema's key set → collect from the composed
 * target env → guard on the brand's DECLARED repo → publish over devkit's `gh`
 * boundary, with its five loud skips) lives once, in
 * `@omega.js/devkit/target-secrets`. Web and the extension ran two
 * near-byte-identical copies of it for one wave; this file now passes a target
 * string and nothing else.
 *
 * What stays web's own is the fourth step — INJECT: the SAME schema set renders
 * the scaffolded workflow's env block, one `KEY: ${{ secrets.KEY }}` line each
 * (`renderSecretsBlock('web')`, @omega.js/config). It is GENERATED, never
 * hand-maintained: `scaffold/.github/workflows/build.yml` carries a
 * `{{ githubSecrets }}` token and the workflow scaffolds with
 * `overwrite: true`, so every verb's ensureTarget re-renders the block — the
 * same heal path as .nvmrc's node version.
 *
 * A key with no value in the cascade is not published (an empty value never
 * claims a key there), but it is still RENDERED into the workflow: what CI
 * needs is what the schema declares, not what this machine's files hold.
 */
const { renderSecretsBlock } = require('@omega.js/config/env-delivery');
const { collectTargetSecrets, declaredBrandRepo: declaredRepoFor, publishTargetSecrets } = require('@omega.js/devkit/target-secrets');

const TARGET = 'web';

/**
 * Collect the publishable secrets for a target: the schema's web delivery set,
 * valued from the COMPOSED env.
 *
 * Positional `targetDir`, the shape its desktop and extension siblings already
 * take ([#723](https://github.com/Omega-JS-Stack/omega/issues/723)).
 *
 * @param {string} targetDir - The target root (its .env is the local layer)
 * @returns {Object<string, string>} key → value, ready to publish
 */
function collectEnvSecrets(targetDir) {
  return collectTargetSecrets({ targetDir, target: TARGET });
}

/**
 * The brand's OWN repo as `owner/name`, from the composed config — the same
 * derivation `omega deploy --direct` uses (`repo.providers.github`, name
 * falling back to brand.id). Null when the config declares nothing usable or
 * doesn't load.
 *
 * @param {string} targetDir - The target root
 * @returns {string|null}
 */
function declaredBrandRepo(targetDir) {
  return declaredRepoFor({ targetDir, target: TARGET });
}

/**
 * The `omega deploy` precheck (#675): publish the target's collected `.env`
 * values as repo Actions secrets.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root
 * @param {object} options.logger - `{ log, warn, error }`
 * @param {object} [options.env] - Env map (default: process.env)
 * @param {function} [options.execFn] - Injectable `gh` exec (tests)
 * @param {function} [options.gitExecFn] - Injectable `git` exec for remote discovery (tests)
 * @returns {{ skipped: string }|{ published: string[], failed: Array<object> }}
 */
function publishEnvSecrets(options) {
  return publishTargetSecrets({ ...(options || {}), target: TARGET });
}

// renderSecretsBlock is @omega.js/config's, re-exported so web's scaffold and
// this module read the block from ONE import site (#627).
module.exports = {
  collectEnvSecrets,
  renderSecretsBlock,
  publishEnvSecrets,
  declaredBrandRepo,
};

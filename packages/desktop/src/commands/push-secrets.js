/**
 * The `.env` → GitHub Actions secrets publisher for the desktop target.
 *
 * Since [#682](https://github.com/Omega-JS-Stack/omega/issues/682) this is a
 * BIND of `@omega.js/devkit/target-secrets`, exactly as web and the extension
 * are: the same derive (the schema's desktop delivery set, #627) → collect (the
 * COMPOSED target env, company ← brand ← target, files only, #678) → guard (the
 * brand's DECLARED repo, never an inferred remote) → publish, over the ONE `gh`
 * transport (values on stdin, never logged), with the same five loud skips. It
 * used to run @octokit/rest + libsodium-wrappers itself on a GH_TOKEN PAT the
 * consumer had to mint; `gh`'s own auth session is the credential now and the
 * sealed-box crypto is the CLI's.
 *
 * What is desktop's OWN is the value resolver, the seam the shared publisher
 * applies between collect and publish: a desktop secret can name a FILE
 * (`CSC_LINK=config/certs/dev-id.p12`, `APPLE_API_KEY=.omega/secrets/key.p8` —
 * target-root relative, falling back to the brand root), and CI needs the
 * BYTES, so an existing file publishes as its base64 contents. The workflow
 * decodes it back to a temp file at job start.
 *
 * Usage:
 *   npx omega push-secrets                       # push every composed desktop key
 *   npx omega push-secrets --only=GH_TOKEN,CSC_LINK
 */

const path = require('path');
const fs = require('fs');

const Manager = new (require('../build.js'));
const logger = Manager.logger('push-secrets');
const { collectTargetSecrets, declaredBrandRepo: declaredRepoFor, publishTargetSecrets } = require('@omega.js/devkit/target-secrets');
const { findBrandRoot } = require('@omega.js/config');

const TARGET = 'desktop';

module.exports = async function (options) {
  options = options || {};

  return publishEnvSecrets({
    targetDir: process.cwd(),
    logger,
    only: options.only,
  });
};

/**
 * Desktop's value seam: base64 for a value that names an existing file, the
 * value itself otherwise, and null for a key `--only` leaves out (the publisher
 * drops a falsy value, the same way it drops an empty composed one).
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @param {string} [options.only] - Comma-separated key names to narrow to.
 * @returns {function} `(value, key) => string|null`
 */
function fileValueResolver(options) {
  const { targetDir } = options;
  const only = options.only ? String(options.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const brandRoot = findBrandRoot(targetDir);

  return (value, key) => {
    if (only && !only.includes(key)) return null;
    return fileContentsBase64(value, { targetDir, brandRoot }) || value;
  };
}

// The base64 contents of the file `value` names, or null when it names none.
// Heuristic: a path-shaped value (a separator, or a typical cert/key extension)
// that resolves to a real file under the target root or the brand root. A
// path-shaped value that exists nowhere is pushed as-is — it is a string.
function fileContentsBase64(value, { targetDir, brandRoot }) {
  const looksLikePath = /[/\\]/.test(value) || /\.(p12|pem|cer|p8|provisionprofile|crt|key|json)$/i.test(value);
  if (!looksLikePath) return null;

  const roots = path.isAbsolute(value) ? [''] : [targetDir, brandRoot].filter(Boolean);
  for (const root of roots) {
    const absolute = path.isAbsolute(value) ? value : path.join(root, value);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      return fs.readFileSync(absolute).toString('base64');
    }
  }

  return null;
}

/**
 * The publishable secrets: the schema's desktop delivery set, valued from the
 * composed env with file-path values resolved to their base64 contents. An
 * empty value never claims a key.
 *
 * @param {string} targetDir - The target root (its .env is the local layer).
 * @param {object} [options]
 * @param {string} [options.only] - Comma-separated key names to narrow to.
 * @returns {Object<string, string>} key → value, ready to publish.
 */
function collectEnvSecrets(targetDir, options) {
  return collectTargetSecrets({
    targetDir,
    target: TARGET,
    resolveValue: fileValueResolver({ targetDir, only: (options || {}).only }),
  });
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
 * The `omega deploy` precheck step: publish the target's composed values as
 * repo Actions secrets.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @param {object} options.logger - `{ log, warn, error }`.
 * @param {object} [options.env] - Env map (default: process.env).
 * @param {string} [options.only] - Comma-separated key names to narrow to (`--only`).
 * @param {function} [options.execFn] - Injectable `gh` exec (tests).
 * @param {function} [options.gitExecFn] - Injectable `git` exec for remote discovery (tests).
 * @returns {{ skipped: string }|{ published: string[], failed: Array<object> }}
 */
function publishEnvSecrets(options) {
  options = options || {};

  return publishTargetSecrets({
    ...options,
    target: TARGET,
    resolveValue: fileValueResolver({ targetDir: options.targetDir, only: options.only }),
  });
}

module.exports.collectEnvSecrets = collectEnvSecrets;
module.exports.declaredBrandRepo = declaredBrandRepo;
module.exports.fileValueResolver = fileValueResolver;
module.exports.publishEnvSecrets = publishEnvSecrets;

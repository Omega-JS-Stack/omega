// Push the desktop target's composed env to GitHub Actions repo secrets.
//
// The KEY SET is the env schema's desktop delivery set
// ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)) and the VALUES
// are the composed target env
// ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)): company .env ←
// brand .env ← target .env. The brand root's .env is the ONE file a human
// keeps; a target .env is an optional per-key override, and no machine writes
// one. Each value is encrypted with the repo's libsodium public key and
// pushed via Octokit. For env vars whose value is a path to an existing file
// (e.g. CSC_LINK=config/certs/dev-id.p12 — target-root relative, falling back
// to the brand root), the secret value is the base64-encoded file contents —
// the workflow then decodes back to a temp file at job start.
//
// Values are NEVER logged: output names the KEY and the layer it came from.
//
// Usage:
//   npx omega push-secrets                       # push every composed desktop key
//   npx omega push-secrets --only=GH_TOKEN,CSC_LINK

const path = require('path');
const fs = require('fs');

const Manager = new (require('../build.js'));
const logger = Manager.logger('push-secrets');
const { discoverRepo } = require('../utils/github.js');
const { declaredBrandRepo } = require('@omega.js/devkit/target-secrets');

module.exports = async function (options) {
  options = options || {};
  const projectRoot = process.cwd();

  // 1. Resolve the .env cascade into process.env for the GH_TOKEN we push
  //    WITH (the VALUES we push come from the composed target env below,
  //    which reads files only).
  const { loadEnv, findBrandRoot } = require('@omega.js/config');
  loadEnv(projectRoot);
  const brandRoot = findBrandRoot(projectRoot);

  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!ghToken) {
    throw new Error('GH_TOKEN not set in .env. Generate a PAT with `repo` scope at https://github.com/settings/tokens');
  }

  // 2. The secrets to push: the composed target env, narrowed by --only.
  const entries = collectEntries({ projectRoot, only: options.only });
  if (entries.length === 0) {
    logger.warn('No secrets to push (after filtering). Are the desktop keys filled in at the brand root .env?');
    return;
  }

  // 3. Discover owner/repo — and REFUSE unless the brand's own config says
  //    that is its repo (#627 review, C5).
  const { owner, repo } = await discoverRepo(projectRoot);
  assertBrandRepo({
    declared: declaredBrandRepo({ targetDir: projectRoot, target: 'desktop' }),
    discovered: `${owner}/${repo}`,
  });

  const named = entries.map((e) => `${e.key} (${e.source})`).join(', ');
  logger.log(`Pushing ${entries.length} secret(s) to ${owner}/${repo}: ${named}`);

  // 4. Get the repo's public key for libsodium encryption
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: ghToken });
  const publicKeyRes = await octokit.rest.actions.getRepoPublicKey({ owner, repo });
  const { key: publicKey, key_id } = publicKeyRes.data;

  const sodium = require('libsodium-wrappers');
  await sodium.ready;

  // 5. Push each.
  let successCount = 0;
  for (const entry of entries) {
    const secretValue = await resolveSecretValue(entry, projectRoot, brandRoot);
    if (secretValue == null) {
      logger.warn(`Skipping ${entry.key} (could not resolve value).`);
      continue;
    }

    const encrypted = encryptSecret(sodium, publicKey, secretValue);

    try {
      await octokit.rest.actions.createOrUpdateRepoSecret({
        owner,
        repo,
        secret_name: entry.key,
        encrypted_value: encrypted,
        key_id,
      });
      const tag = entry.isFilePath ? 'file' : 'string';
      logger.log(logger.format.green(`✓ ${entry.key} (${tag})`));
      successCount += 1;
    } catch (e) {
      logger.error(`✗ ${entry.key}: ${e.message}`);
    }
  }

  logger.log(logger.format.green(`Pushed ${successCount}/${entries.length} secret(s) to ${owner}/${repo}.`));
};

// The entries to push: the env schema's desktop DELIVERY set
// ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)) — the same list
// the generated workflow block consumes, because a secret CI never reads has no
// business in the repo — valued from the target's composed env (company ←
// brand ← target, `deliverAs` applied, so the brand's
// GOOGLE_ANALYTICS_SECRET_DESKTOP arrives as GOOGLE_ANALYTICS_SECRET), and
// narrowed by --only. An empty value never claims a key in the composer, so no
// skip-empty pass is needed here; `machineLocal` keys are already out of the
// delivery set.
//
// Returns: [{ key, value, source: 'company' | 'brand' | 'target' }, ...]
function collectEntries({ projectRoot, only }) {
  const { composeTargetEnv } = require('@omega.js/config');
  const { publishSecretKeys } = require('@omega.js/config/env-delivery');
  const { values, sources } = composeTargetEnv({ targetDir: projectRoot, target: 'desktop' });

  const wanted = only ? String(only).split(',').map((s) => s.trim()).filter(Boolean) : null;

  return publishSecretKeys('desktop')
    .filter((key) => values[key])
    .filter((key) => !wanted || wanted.includes(key))
    .map((key) => ({ key, value: values[key], source: sources[key] }));
}

// Determine the secret value to push:
//   - If value looks like a path AND the file exists → base64-encoded file contents
//     (target-root relative first; brand-root fallback for brand-level cert values)
//   - Otherwise → value as-is
async function resolveSecretValue(entry, projectRoot, brandRoot) {
  const v = entry.value;
  if (!v) return v;

  // Heuristic: relative or absolute path, ending in a typical cert/key extension
  // OR an existing file regardless of extension.
  const looksLikePath = /[/\\]/.test(v) || /\.(p12|pem|cer|p8|provisionprofile|crt|key|json)$/i.test(v);
  if (!looksLikePath) return v;

  const roots = path.isAbsolute(v) ? [''] : [projectRoot, brandRoot].filter(Boolean);
  for (const root of roots) {
    const absolute = path.isAbsolute(v) ? v : path.join(root, v);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      entry.isFilePath = true;
      return fs.readFileSync(absolute).toString('base64');
    }
  }

  return v; // value contains slashes but doesn't exist anywhere — push as-is
}

function encryptSecret(sodium, publicKey, value) {
  const messageBytes = Buffer.from(value);
  const keyBytes = Buffer.from(publicKey, 'base64');
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  return Buffer.from(encryptedBytes).toString('base64');
}

/**
 * Refuse to publish anywhere the brand has not CLAIMED as its own repo (#627
 * review, C5 — web and extension gained this guard first).
 *
 * The signing material this command pushes is the most dangerous payload in the
 * stack, and an inferred git remote is not proof of where it belongs: a target
 * vendored into a framework/test monorepo, a cloned starter whose origin still
 * points at the template author, or any fork would arm a stranger's Actions
 * with this brand's certificates. The only acceptable proof is the brand's own
 * config (`repo.providers.github`).
 *
 * @param {object} input
 * @param {string|null} input.declared - The brand's declared `owner/name`, or null.
 * @param {string} input.discovered - The `owner/name` the git remote resolved to.
 * @throws {Error} when the brand declares no repo, or declares a different one.
 */
function assertBrandRepo({ declared, discovered }) {
  if (!declared) {
    throw new Error('Refusing to push secrets — this brand names no GitHub repo in config (repo.providers.github). Set it, then re-run `omega push-secrets`.');
  }

  if (declared.toLowerCase() !== String(discovered).toLowerCase()) {
    throw new Error(`Refusing to push secrets — the git remote here is ${discovered}, but this brand's repo is ${declared}. Run \`omega push-secrets\` from the brand's own checkout.`);
  }
}

// Exported for tests.
module.exports.assertBrandRepo = assertBrandRepo;
module.exports.collectEntries = collectEntries;
module.exports.resolveSecretValue = resolveSecretValue;
module.exports.discoverRepo = discoverRepo;

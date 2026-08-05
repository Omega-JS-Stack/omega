/**
 * The `.env` → GitHub Actions secrets pair (#189), UJM's setup capability
 * rebuilt on the OMEGA cascade:
 *
 *   1. COLLECT — every key in the app's resolved `.env` cascade
 *      (shell > app .env > brand .env > company .env, D15), filtered exactly
 *      the way UJM's `publishSecrets()` filtered (see FILTER below).
 *   2. PUBLISH — each collected key becomes a repo Actions secret, via
 *      devkit's `gh` boundary (values on stdin, never logged).
 *   3. INJECT — the same key set renders the scaffolded workflow's env block,
 *      one `KEY: ${{ secrets.KEY }}` line each. It is GENERATED, never
 *      hand-maintained: `scaffold/.github/workflows/build.yml` carries a
 *      `{{ githubSecrets }}` token and the workflow scaffolds with
 *      `overwrite: true`, so every `omega setup` re-renders the block from the
 *      current `.env` — the same heal path as .nvmrc's node version.
 *
 * FILTER (mirrored from ultimate-jekyll-manager/src/commands/setup.js:419-428):
 * blank lines and `#` comments are skipped, the key must be UPPER_SNAKE
 * (`[A-Z_][A-Z0-9_]*`), wrapping quotes are stripped, and the VALUE must be
 * non-empty. There is no non-secret exclusion list: the legacy published
 * everything in `.env`, and so does this (a `.env` key is a secret by
 * definition — placeholders ship commented out). One consequence rides along
 * verbatim: an inline `KEY=v # note` comment is part of the value, exactly as
 * it was in UJM.
 *
 * ONE deliberate deviation: the legacy's lazy `["']?(.+?)["']?$` group leaves
 * `KEY=""` with a lone `"` as its value, which would publish a junk secret AND
 * contradict the cascade's own rule that an empty value never claims a key
 * (`@omega.js/config`'s env.js). Quotes strip as a matched PAIR here (the
 * desktop push-secrets reading), so `KEY=""` is empty and drops out.
 */
const path = require('node:path');
const fs = require('node:fs');

const { resolveEnvChain } = require('@omega.js/config');
const { publishActionsSecrets } = require('@omega.js/devkit/actions-secrets');
const { resolveRepo } = require('@omega.js/devkit/deploy');

// UJM's line filter: UPPER_SNAKE key, everything after the first `=` is the
// raw value (quote stripping happens on the pair, see the header).
const ENV_LINE = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

// Keys the workflow template already declares at the env: block — never
// duplicated by the generated block (a repeated YAML mapping key is invalid).
const WORKFLOW_OWNED_KEYS = ['GH_TOKEN', 'NODE_VERSION', 'NODE_ENV'];

// Rendered in place of the block when nothing is collected, so the generated
// region is always a valid, self-explaining line of YAML.
const EMPTY_BLOCK = '# (no .env keys collected — `omega setup` regenerates this block)';

/** Strip a matched wrapping quote pair (`"x"` / `'x'` → `x`). */
function stripQuotes(value) {
  const quoted = value.length > 1
    && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
  return quoted ? value.slice(1, -1) : value;
}

/**
 * Parse one .env file's contents with the legacy filter.
 * @param {string} contents
 * @returns {Object<string, string>} key → value (non-empty values only)
 */
function parseEnvFile(contents) {
  const secrets = {};

  for (const line of String(contents || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(ENV_LINE);
    if (!match) continue;

    const value = stripQuotes(match[2].trim());
    if (value) secrets[match[1]] = value;
  }

  return secrets;
}

/**
 * Collect the publishable secrets for an app from its `.env` cascade.
 *
 * Precedence is the cascade's (`@omega.js/config`): strongest layer with a
 * NON-EMPTY value wins — app .env over brand .env over company .env — and the
 * shell overrides any of them for a key the files declare. A key that exists
 * only in the shell is never collected: `.env` names the key set, the cascade
 * supplies the value (D15).
 *
 * @param {object} options
 * @param {string} options.appDir - The app root (its .env is the app layer)
 * @param {object} [options.env] - Shell env map (default: process.env)
 * @returns {Object<string, string>} key → value, ready to publish
 */
function collectEnvSecrets(options) {
  options = options || {};
  const chain = resolveEnvChain(options.appDir);
  const env = options.env || process.env;

  const secrets = {};
  // Weakest first, so a stronger layer's value overwrites.
  for (const envPath of [chain.company, chain.brand, chain.app]) {
    if (!envPath || !fs.existsSync(envPath)) continue;
    Object.assign(secrets, parseEnvFile(fs.readFileSync(envPath, 'utf8')));
  }

  for (const key of Object.keys(secrets)) {
    const shell = env[key];
    if (shell && shell.trim()) secrets[key] = shell;
  }

  return secrets;
}

/**
 * Render the workflow's generated env block: one `KEY: ${{ secrets.KEY }}`
 * line per key, sorted (a deterministic block re-renders byte-identical, so
 * the scaffold's idempotency check reports no write). Lines join at the
 * token's 2-space indent, and keys the template already declares are dropped.
 *
 * @param {string[]} keys - Collected secret names
 * @returns {string} The block body (no leading indent — the token supplies it)
 */
function renderSecretsBlock(keys) {
  const lines = [...new Set(keys || [])]
    .filter((key) => !WORKFLOW_OWNED_KEYS.includes(key))
    .sort()
    .map((key) => `${key}: \${{ secrets.${key} }}`);

  return lines.length ? lines.join('\n  ') : EMPTY_BLOCK;
}

/**
 * The brand's OWN repo as `owner/name`, from the composed config — the same
 * derivation `omega deploy --direct` uses (`repo.providers.github`, name
 * falling back to brand.id). Null when the config declares nothing usable or
 * doesn't load.
 *
 * @param {string} appDir - The app root
 * @returns {string|null}
 */
function declaredBrandRepo(appDir) {
  try {
    const { loadConfig, brandRepoOwner, brandRepoName } = require('@omega.js/config');
    const { config } = loadConfig(appDir, 'web');
    if (!config) return null;

    const owner = brandRepoOwner(config);
    const name = brandRepoName(config);
    return owner && name ? `${owner}/${name}` : null;
  } catch (e) {
    return null;
  }
}

/**
 * The `omega setup` step: publish the app's collected `.env` values as repo
 * Actions secrets. Skips LOUDLY (a log line, never silence) when there is
 * nothing to publish, no GitHub remote, the enclosing checkout is not the
 * brand's own repo, or the run is CI itself.
 *
 * Missing/signed-out `gh` is NOT a skip — it throws devkit's instructions
 * (install, `gh auth login`, or `omega setup --no-secrets`).
 *
 * @param {object} options
 * @param {string} options.appDir - The app root
 * @param {object} options.logger - `{ log, warn, error }`
 * @param {object} [options.env] - Env map (default: process.env)
 * @param {function} [options.execFn] - Injectable `gh` exec (tests)
 * @param {function} [options.gitExecFn] - Injectable `git` exec for remote discovery (tests)
 * @returns {{ skipped: string }|{ published: string[], failed: Array<object> }}
 */
function publishEnvSecrets(options) {
  options = options || {};
  const { appDir, logger } = options;
  const env = options.env || process.env;

  // CI runs `npx omega setup` as its build step (the scaffolded workflow) —
  // the secrets already exist there and the runner token can't write them.
  if (env.GITHUB_ACTIONS === 'true' || env.CI === 'true') {
    logger.log('Skipping secret publication — CI already has the repo secrets');
    return { skipped: 'ci' };
  }

  const secrets = collectEnvSecrets({ appDir, env });
  const keys = Object.keys(secrets);
  if (!keys.length) {
    logger.warn('Skipping secret publication — no .env values found in the cascade (app/brand/company)');
    return { skipped: 'no-secrets' };
  }

  let repo;
  try {
    const { owner, repo: name } = resolveRepo({ cwd: appDir, execFn: options.gitExecFn });
    repo = `${owner}/${name}`;
  } catch (e) {
    logger.warn(`Skipping secret publication — no GitHub remote here (${e.message})`);
    return { skipped: 'no-remote' };
  }

  // Secrets belong to the repo whose Actions run the workflow — and the ONLY
  // acceptable proof of which repo that is, is the brand's own config
  // (repo.providers.github). An inferred git remote is not proof: an app
  // vendored into a framework/test monorepo, a cloned starter whose origin
  // still points at the template author, or any fork would publish this
  // brand's .env to a stranger's Actions. The legacy this ports from took an
  // explicit target too, never an inferred remote.
  const declared = declaredBrandRepo(appDir);
  if (!declared) {
    logger.warn('Skipping secret publication — this brand names no GitHub repo in config (repo.providers.github). Set it, then re-run setup.');
    return { skipped: 'no-declared-repo' };
  }
  if (declared.toLowerCase() !== repo.toLowerCase()) {
    logger.warn(`Skipping secret publication — the git remote here is ${repo}, but this brand's repo is ${declared}. Run setup from the brand's own checkout.`);
    return { skipped: 'repo-mismatch' };
  }

  logger.log(`Publishing ${keys.length} secret(s) to ${repo}: ${keys.join(', ')}`);

  const result = publishActionsSecrets({ repo, secrets, logger, execFn: options.execFn });
  logger.log(`Published ${result.published.length}/${keys.length} secret(s) to ${repo}`);

  return result;
}

module.exports = {
  collectEnvSecrets,
  parseEnvFile,
  renderSecretsBlock,
  publishEnvSecrets,
  declaredBrandRepo,
  ENV_LINE,
  WORKFLOW_OWNED_KEYS,
  EMPTY_BLOCK,
};

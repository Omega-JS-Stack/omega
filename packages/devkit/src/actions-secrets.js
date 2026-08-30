/**
 * GitHub Actions repo secrets — the shared publish boundary (#189).
 *
 * One mechanism for every framework whose CI needs the brand's `.env` keys as
 * repo secrets: hand it a repo (`owner/name`) and a key → value map, it sets
 * each one. The transport is the `gh` CLI (`gh secret set KEY --repo o/n`,
 * which encrypts locally with the repo's public key before sending) — there is
 * NO libsodium/REST fallback here (UJM's path): without a usable `gh` this
 * FAILS LOUDLY with install/auth instructions rather than growing a crypto
 * dependency to do what the CLI already does.
 *
 * Two invariants:
 *   - Values travel on STDIN, never in argv — argv is world-readable in `ps`
 *     and lands in exec error messages. `gh secret set` reads the value from
 *     stdin whenever `--body` is absent.
 *   - Values are NEVER logged. Only key names appear in output.
 *
 * Idempotency: the API exposes no way to read a secret's current value back,
 * so "skip if unchanged" is not detectable. Publishing is therefore
 * unconditional — setting the same value twice is harmless (GitHub replaces
 * the sealed box), so a re-run of `omega deploy` costs one API call per key and
 * changes nothing.
 */
const { execFileSync } = require('node:child_process');

const GH_INSTRUCTIONS = [
  'The GitHub CLI is required to publish Actions secrets.',
  '  install: https://cli.github.com  (macOS: brew install gh)',
  '  sign in: gh auth login',
  '  or skip: run deploy with --no-secrets',
].join('\n');

/** Default exec boundary — execFileSync, injectable everywhere below (tests). */
function defaultExecFn(file, args, options) {
  return execFileSync(file, args, options).toString();
}

/**
 * The argv for one `gh secret set` call. The VALUE is deliberately absent —
 * it is delivered on stdin by setActionsSecret.
 *
 * @param {object} options
 * @param {string} options.repo - `owner/name`
 * @param {string} options.key - Secret name
 * @returns {string[]} gh arguments
 */
function buildSecretArgs(options) {
  const { repo, key } = options || {};
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error(`[devkit actions-secrets] repo must be "owner/name", got: ${repo || '(none)'}`);
  }
  if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`[devkit actions-secrets] invalid secret name: ${key || '(none)'}`);
  }
  return ['secret', 'set', key, '--repo', repo];
}

/**
 * Assert a usable `gh`: installed AND authenticated. `gh auth status` covers
 * both — a missing binary throws ENOENT, an anonymous CLI exits non-zero.
 *
 * @param {object} [options]
 * @param {function} [options.execFn] - Injectable exec (tests)
 * @throws {Error} With install/auth instructions when gh is unusable.
 */
function assertGhReady(options) {
  const execFn = (options || {}).execFn || defaultExecFn;
  try {
    execFn('gh', ['auth', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`[devkit actions-secrets] ${GH_INSTRUCTIONS}`);
  }
}

/**
 * Set ONE Actions repo secret. The value goes to gh's stdin.
 *
 * @param {object} options
 * @param {string} options.repo - `owner/name`
 * @param {string} options.key - Secret name
 * @param {string} options.value - Secret value (stdin; never logged)
 * @param {function} [options.execFn] - Injectable exec (tests)
 */
function setActionsSecret(options) {
  const { repo, key, value } = options || {};
  const execFn = (options || {}).execFn || defaultExecFn;

  execFn('gh', buildSecretArgs({ repo, key }), {
    input: String(value == null ? '' : value),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Publish a whole key → value map as Actions repo secrets.
 *
 * Precondition failure (no usable gh) throws — that is the loud failure. A
 * single key's failure does NOT abort the rest: every key is attempted and the
 * failures come back named, so one revoked scope can't hide the other 12.
 *
 * @param {object} options
 * @param {string} options.repo - `owner/name`
 * @param {Object<string, string>} options.secrets - key → value
 * @param {function} [options.execFn] - Injectable exec (tests)
 * @param {object} [options.logger] - `{ log, warn, error }` (defaults to console)
 * @returns {{ published: string[], failed: Array<{ key: string, message: string }> }}
 */
function publishActionsSecrets(options) {
  options = options || {};
  const repo = options.repo;
  const secrets = options.secrets || {};
  const execFn = options.execFn || defaultExecFn;
  const logger = options.logger || console;

  const keys = Object.keys(secrets);
  const result = { published: [], failed: [] };
  if (keys.length === 0) return result;

  assertGhReady({ execFn });

  for (const key of keys) {
    try {
      setActionsSecret({ repo, key, value: secrets[key], execFn });
      result.published.push(key);
    } catch (e) {
      // Only the KEY and the command line are reported. Node appends the
      // child's stderr to execFileSync's error message, and a gh (or wrapper)
      // that echoed its stdin would put the VALUE there — so the message is
      // cut to its first line, which is always the command (names only).
      const message = String(e.message || e).split('\n', 1)[0];
      result.failed.push({ key, message });
      logger.error(`Failed to publish secret ${key}: ${message}`);
    }
  }

  return result;
}

module.exports = {
  buildSecretArgs,
  assertGhReady,
  setActionsSecret,
  publishActionsSecrets,
  GH_INSTRUCTIONS,
};

/**
 * The git REMOTE boundary: the url a checkout points at, parsed, retargeted and
 * written ([#890](https://github.com/Omega-JS-Stack/omega/issues/890)).
 *
 * `parseRemoteUrl` lived in `deploy.js`, whose load pulls in the local-link,
 * pack and snapshot modules: 40ms nothing on the CLI BOOT path can spend for
 * one regex. The boot prelude that heals a redirected `origin` needs the parse
 * plus the two git calls around it, so the three live here, in one place, and
 * `deploy.js` re-exports the parse it already published. The brand's own origin,
 * read once for the prelude, the manage walk and the deploy alike, and the
 * refusal the latter two raise when it disagrees with the config, live here too
 * ([#934](https://github.com/Omega-JS-Stack/omega/issues/934)).
 *
 * Transport: `git` through execFile with an ARGV ARRAY, never a shell string,
 * so a remote url can never inject a command. Every call names its directory
 * with `-C`: git resolves a repo by walking UP, and a brand nested inside
 * another repo would otherwise read (and rewrite) the enclosing repo's
 * remote.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const jetpack = require('fs-jetpack');

/**
 * Parse a git remote URL into { owner, repo }.
 * Handles ssh (git@github.com:o/r.git), https (https://github.com/o/r.git),
 * and .git-less forms.
 * @param {string} url - remote URL
 * @returns {{ owner: string, repo: string }|null} Null for anything that is not a GitHub remote.
 */
function parseRemoteUrl(url) {
  const match = (url || '').trim().match(/github\.com[/:]([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * The same remote url, addressing another repo: the slug is substituted in
 * place, so the url keeps its OWN form (an ssh remote stays ssh, an https
 * remote stays https, a `.git` suffix stays or stays absent). A rewrite that
 * normalized the form would change how the checkout authenticates.
 *
 * @param {string} url - The current remote url.
 * @param {string} slug - The `owner/name` to point it at.
 * @returns {string} The retargeted url.
 * @throws {Error} When the url is not a GitHub remote (the caller parsed it already).
 */
function retargetRemoteUrl(url, slug) {
  const current = parseRemoteUrl(url);
  if (!current) {
    throw new Error(`Cannot retarget a remote url that names no GitHub repo: ${String(url).trim() || '(none)'}`);
  }

  const trimmed = url.trim();
  const currentSlug = `${current.owner}/${current.repo}`;
  const at = trimmed.lastIndexOf(currentSlug);

  return trimmed.slice(0, at) + slug + trimmed.slice(at + currentSlug.length);
}

/**
 * A remote's url, as the checkout has it.
 * @param {object} options
 * @param {string} options.dir - The repository directory.
 * @param {string} [options.remote] - Remote name (default: origin).
 * @param {function} [options.execFn] - Injectable `(file, args, opts) => stdout` (tests).
 * @returns {string} The trimmed url.
 * @throws {Error} When git has no such remote, or the directory is no repository.
 */
function remoteUrl(options) {
  const execFn = options.execFn || execFileSync;
  const args = ['-C', options.dir, 'remote', 'get-url', options.remote || 'origin'];

  return String(execFn('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })).trim();
}

/**
 * Point a remote at another url.
 * @param {object} options
 * @param {string} options.dir - The repository directory.
 * @param {string} options.url - The url to set.
 * @param {string} [options.remote] - Remote name (default: origin).
 * @param {function} [options.execFn] - Injectable exec (tests).
 * @returns {void}
 * @throws {Error} When git refuses the write.
 */
function setRemoteUrl(options) {
  const execFn = options.execFn || execFileSync;
  const args = ['-C', options.dir, 'remote', 'set-url', options.remote || 'origin', options.url];

  execFn('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * A brand's OWN `origin`, read and parsed: the one read the boot prelude, the
 * manage walk and the deploy share
 * ([#934](https://github.com/Omega-JS-Stack/omega/issues/934)).
 *
 * The `.git` must sit AT the directory, answered by one stat before git is
 * asked anything: a brand nested in another repo (a fixture brand inside this
 * monorepo, a target checked out under someone else's tree) has no origin of
 * its own, and reading the ENCLOSING repo's would compare, heal or refuse on a
 * repo the brand is not. No origin, and an origin that is not a GitHub remote,
 * are expected conditions (a checkout nobody has pushed yet, a brand hosted
 * elsewhere), so each answers its reason rather than throwing.
 *
 * @param {object} options
 * @param {string} options.dir - The brand root.
 * @param {function} [options.execFn] - Injectable `(file, args, opts) => stdout` (tests).
 * @returns {{ url: string, owner: string, repo: string, slug: string }|{ reason: 'no-git'|'no-origin'|'foreign-remote' }}
 */
function readOrigin(options) {
  if (!jetpack.exists(path.join(options.dir, '.git'))) return { reason: 'no-git' };

  let url;
  try {
    url = remoteUrl({ dir: options.dir, execFn: options.execFn });
  } catch (e) {
    return { reason: 'no-origin' };
  }

  const parsed = parseRemoteUrl(url);
  if (!parsed) return { reason: 'foreign-remote' };

  return { url, owner: parsed.owner, repo: parsed.repo, slug: `${parsed.owner}/${parsed.repo}` };
}

/**
 * Refuse when the brand's `origin` names another repo than the source repo its
 * config derives ([#934](https://github.com/Omega-JS-Stack/omega/issues/934)).
 * Called by the verbs that ACT on the derived repo (the manage walk's repo
 * service, the deploy lane), which would otherwise ensure or push to a repo the
 * checkout does not point at. The boot prelude only states the same line: it
 * runs before every verb, and a fatal boot would lock out the verbs that fix it.
 *
 * Nothing to compare is no refusal: a brand with no origin of its own (see
 * `readOrigin`), and a config that derives no source repo.
 *
 * @param {object} options
 * @param {string} options.dir - The brand root.
 * @param {object} [options.config] - The composed config. Omitted, the brand's
 *   PRODUCTION config is loaded from `dir` (the one every deploy address reads,
 *   [#856](https://github.com/Omega-JS-Stack/omega/issues/856)), and only once
 *   an origin exists to compare it with.
 * @param {function} [options.execFn] - Injectable git exec (tests).
 * @returns {object} The `readOrigin` answer it compared (or had nothing to
 *   compare with), so a caller that treats a missing origin its own way reads
 *   the reason without a second read.
 * @throws {Error} The drift line, from `@omega.js/config`'s `repoDrift`.
 */
function assertOriginMatches(options) {
  const origin = readOrigin(options);
  if (!origin.slug) return origin;

  const { loadConfig, repoDrift } = require('@omega.js/config');
  const config = options.config || loadConfig(options.dir, null, { environment: 'production' }).config;
  const drift = repoDrift(origin.slug, config);

  if (drift) throw new Error(drift);

  return origin;
}

module.exports = {
  parseRemoteUrl,
  retargetRemoteUrl,
  remoteUrl,
  setRemoteUrl,
  readOrigin,
  assertOriginMatches,
};

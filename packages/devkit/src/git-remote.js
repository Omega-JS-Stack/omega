/**
 * The git REMOTE boundary: the url a checkout points at, parsed, retargeted and
 * written ([#890](https://github.com/Omega-JS-Stack/omega/issues/890)).
 *
 * `parseRemoteUrl` lived in `deploy.js`, whose load pulls in the local-link,
 * pack and snapshot modules: 40ms nothing on the CLI BOOT path can spend for
 * one regex. The boot prelude that heals a redirected `origin` needs the parse
 * plus the two git calls around it, so the three live here, in one place, and
 * `deploy.js` re-exports the parse it already published.
 *
 * Transport: `git` through execFile with an ARGV ARRAY, never a shell string,
 * so a remote url can never inject a command. Every call names its directory
 * with `-C`: git resolves a repo by walking UP, and a brand nested inside
 * another repo would otherwise read (and rewrite) the enclosing repo's
 * remote.
 */

const { execFileSync } = require('node:child_process');

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

module.exports = {
  parseRemoteUrl,
  retargetRemoteUrl,
  remoteUrl,
  setRemoteUrl,
};

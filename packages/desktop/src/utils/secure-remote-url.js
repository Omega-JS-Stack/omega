/**
 * isSecureRemoteUrl(url) — transport gate for the remote code/config lanes
 * (lib/remote-scripts.js, lib/remote-config.js), which execute or apply
 * network-fetched content. Only `https:` passes; `http:` is allowed solely
 * for loopback hosts so local dev servers keep working. Unparseable URLs
 * fail closed.
 *
 * @param {string} url - The resolved fetch URL.
 * @returns {boolean} True when the URL is safe to fetch remote content from.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isSecureRemoteUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return false;
  }

  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
}

module.exports = { isSecureRemoteUrl };

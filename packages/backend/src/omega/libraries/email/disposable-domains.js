/**
 * The disposable-email-domain dataset — a committed SEED plus a gitignored refresh CACHE.
 *
 * Source: https://github.com/disposable-email-domains/disposable-email-domains
 * (curated, low false-positive rate)
 *
 * The contract (issue #68):
 * - `data/disposable-domains.json` is the SEED: committed, and only ever written
 *   by the deliberate `promote()` step. Refreshes never touch it, so a suite run
 *   or a prepare build can no longer dirty the git tree.
 * - `refresh()` fetches the upstream list and writes ONLY to the gitignored cache
 *   at `<package>/.cache/email/disposable-domains.json`.
 * - `load()` reads the cache when it is present and parseable, else the seed.
 *   No network, no cache, offline clone — the seed always answers.
 * - `promote()` copies cache → seed when the committed baseline should advance.
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const SOURCE_URL = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf';

// The committed baseline, beside the other email data files.
const SEED_PATH = path.join(__dirname, 'data', 'disposable-domains.json');

// The gitignored refresh cache. The package root is four levels up from here in
// BOTH trees — src/manager/libraries/email/ and the staged dist/manager/libraries/email/.
const CACHE_PATH = path.join(__dirname, '..', '..', '..', '..', '.cache', 'email', 'disposable-domains.json');

/**
 * The active domain list: the refresh cache if usable, else the committed seed.
 *
 * @returns {string[]}
 */
function load() {
  try {
    const cached = jetpack.read(CACHE_PATH, 'json');
    if (Array.isArray(cached) && cached.length > 0) {
      return cached;
    }
  } catch (e) {
    // A truncated/corrupt cache (interrupted write) is an expected external
    // condition, not a bug — never fail an email lookup over it, use the seed.
  }

  return require(SEED_PATH);
}

/**
 * Fetch the upstream list and write it to the gitignored cache. Never writes the seed.
 *
 * @returns {Promise<{ path: string, count: number }>}
 */
async function refresh() {
  const response = await fetch(SOURCE_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const domains = text
    .trim()
    .split('\n')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);

  const unique = [...new Set(domains)].sort();

  jetpack.write(CACHE_PATH, `${JSON.stringify(unique, null, 2)}\n`);

  return { path: CACHE_PATH, count: unique.length };
}

/**
 * Advance the committed baseline: copy the refresh cache over the seed.
 * Deliberate only — nothing calls this automatically.
 *
 * @returns {{ path: string, count: number }}
 */
function promote() {
  const cached = jetpack.read(CACHE_PATH, 'json');

  if (!Array.isArray(cached) || cached.length === 0) {
    throw new Error(`No usable refresh cache at ${CACHE_PATH} — run \`node scripts/update-disposable-domains.js\` first.`);
  }

  jetpack.write(SEED_PATH, `${JSON.stringify(cached, null, 2)}\n`);

  return { path: SEED_PATH, count: cached.length };
}

module.exports = { SOURCE_URL, SEED_PATH, CACHE_PATH, load, refresh, promote };

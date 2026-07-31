// Where the macOS signing certificate comes from — the ONE lookup order.
//
//   1. CSC_LINK in the environment — an explicit answer always wins.
//   2. The BRAND's gitignored signing tree:
//      <brandRoot>/.omega/certificates/apple/certificates/DEVELOPER_ID_APPLICATION_G2.p12
//      The brand root is the nearest directory at or above the app carrying a
//      `.omega/`. The manager's disperse service also copies this material into
//      each app's config/certs/; this lookup is the portable/CI path that needs
//      no dispersal first.
//   3. The COMPANY's tree, when the brand is company-managed. A brand is NEVER
//      physically inside its company folder — membership is the
//      `.omega/company.json` stamp at the brand root, read through
//      @omega.js/config's readCompanyRoot (the ecosystem's ONE company rule; no
//      second reader lives here). The stamp's target is used as given: it is
//      explicit config, not discovery, so the home bound below does not apply to it.
//   4. The macOS Keychain — electron-builder's own identity auto-discovery,
//      which is what happens when nothing sets CSC_LINK.
//
// Keychain stays the DEFAULT for local signed builds: a tree with no cert (every
// setup that predates the certificates service) resolves to it untouched. Two
// further conditions keep it there rather than handing electron-builder a file
// it cannot use:
//   - no CSC_KEY_PASSWORD (it comes from the .env cascade, never from config), or
//   - a password that does not OPEN the .p12. An unopenable .p12 fails the build
//     outright — worse than today's behavior. The check is the read-side twin of
//     how the manager EXPORTS one (openssl `pkcs12 -legacy`; the legacy provider
//     reads modern containers too).
//
// The brand-root walk stops BELOW the home directory: `~/.omega` is a real
// personal overlay on developer machines, and a stray tree there must never sign
// every build.

const { execFileSync } = require('node:child_process');
const { homedir } = require('node:os');
const { dirname, join } = require('node:path');
const jetpack = require('fs-jetpack');
const { readCompanyRoot } = require('@omega.js/config');

const OMEGA_DIR = '.omega';
const CERT_REL = join(OMEGA_DIR, 'certificates', 'apple', 'certificates', 'DEVELOPER_ID_APPLICATION_G2.p12');

/**
 * The brand root an app belongs to: the nearest directory at or above it
 * carrying a `.omega/`. Stops below the home directory.
 *
 * @param {string} from - Directory to start walking up from
 * @param {string} homeDir - Boundary: this directory and everything above never count
 * @returns {string|null}
 */
function findBrandRoot(from, homeDir) {
  let dir = from;

  while (true) {
    // The home directory itself — and everything above it — is out of bounds.
    if (dir === homeDir) {
      return null;
    }

    if (jetpack.exists(join(dir, OMEGA_DIR)) === 'dir') {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * The signing certificate a root holds, if any.
 *
 * @param {string|null} root
 * @returns {string|null} - Absolute path to the .p12, or null
 */
function certificateIn(root) {
  if (!root) {
    return null;
  }

  const candidate = join(root, CERT_REL);
  return jetpack.exists(candidate) === 'file' ? candidate : null;
}

/**
 * Does this password actually open the container?
 *
 * Two openssl families answer differently: OpenSSL 3 needs `-legacy` to read
 * the legacy-format containers the manager exports (macOS `security import`
 * needs that format), while stock macOS /usr/bin/openssl is LibreSSL, which
 * rejects the `-legacy` FLAG but reads legacy containers natively. A flag
 * rejection is retried without it; only a real password/container failure
 * counts as "does not open".
 *
 * @param {string} p12Path - Path to the .p12
 * @param {string} password - Candidate password
 * @returns {{ opens: boolean, tooling?: string }} - tooling set when openssl
 *   itself was unavailable/unusable, so the caller can say so instead of
 *   blaming the password
 */
function opensWith(p12Path, password) {
  // Password rides an env var — never argv, never a shell string.
  const run = (args) => execFileSync(
    'openssl',
    ['pkcs12', ...args, '-in', p12Path, '-nokeys', '-noout', '-passin', 'env:OMEGA_P12_PASSWORD'],
    { stdio: 'pipe', env: { ...process.env, OMEGA_P12_PASSWORD: password } },
  );

  try {
    run(['-legacy']);
    return { opens: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { opens: false, tooling: 'openssl is not available' };
    }

    if (String(error.stderr || '').includes('unknown option')) {
      try {
        run([]);
        return { opens: true };
      } catch (retryError) {
        if (retryError.code === 'ENOENT') {
          return { opens: false, tooling: 'openssl is not available' };
        }
        return { opens: false };
      }
    }

    return { opens: false };
  }
}

/**
 * Resolve which certificate source a signed build should use.
 *
 * @param {object} options
 * @param {string} options.projectRoot - The desktop app's root
 * @param {object} [options.env] - Environment to read (default process.env)
 * @param {string} [options.homeDir] - Walk boundary (default os.homedir())
 * @returns {{ source: 'env'|'certificates'|'keychain', cscLink: string|null, reason: string }}
 */
function resolveSigningCert({ projectRoot, env = process.env, homeDir = homedir() }) {
  const cscLink = typeof env.CSC_LINK === 'string' ? env.CSC_LINK.trim() : '';

  if (cscLink) {
    return { source: 'env', cscLink, reason: 'CSC_LINK is set' };
  }

  // The brand's own tree first, then the company's — reached ONLY through the
  // brand's .omega/company.json stamp, never by walking up into a parent folder.
  const brandRoot = findBrandRoot(projectRoot, homeDir);
  const found = certificateIn(brandRoot) || certificateIn(brandRoot && readCompanyRoot(brandRoot));

  if (!found) {
    return { source: 'keychain', cscLink: null, reason: 'no .omega/certificates signing tree — using Keychain identity discovery' };
  }

  if (!env.CSC_KEY_PASSWORD) {
    return { source: 'keychain', cscLink: null, reason: `found ${found} but CSC_KEY_PASSWORD is unset — using Keychain identity discovery` };
  }

  const check = opensWith(found, env.CSC_KEY_PASSWORD);
  if (check.tooling) {
    return { source: 'keychain', cscLink: null, reason: `${check.tooling} — cannot verify ${found}; using Keychain identity discovery` };
  }
  if (!check.opens) {
    return { source: 'keychain', cscLink: null, reason: `CSC_KEY_PASSWORD does not open ${found} — using Keychain identity discovery` };
  }

  return { source: 'certificates', cscLink: found, reason: 'signing certificate from the brand .omega/certificates tree' };
}

module.exports = resolveSigningCert;
module.exports.CERT_REL = CERT_REL;

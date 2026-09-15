/**
 * The signing paths, derived ONCE
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
 *
 * CSC_LINK and APPLE_API_KEY name FILES, and the files live in the signing
 * tree: `<company or brand root>/.omega/certificates/apple/`, company tier
 * first (`@omega.js/devkit/signing-tree`, #892). Nobody types those paths into
 * a `.env`, so every reader used to derive them for itself: the build did, the
 * secrets publish did, and validate-certs did NOT, which is how a deploy stopped
 * on `Found .p12 in config/certs/ but CSC_LINK env var is not set` while the
 * build beside it signed fine. One rule, one home: the desktop env load calls
 * this, and the build, validate-certs and the secrets publish all read the env
 * it populated.
 *
 * The lookup order this function IS (the four rungs the desktop signing lookup
 * always had):
 *   1. an explicit env value wins, always: nothing here overwrites a set key;
 *   2. the COMPANY tree, when the brand names one (`company: { id }`, #677);
 *   3. the BRAND's own tree;
 *   4. nothing set, which leaves electron-builder's Keychain identity
 *      discovery as the default a tree-less machine keeps getting.
 *
 * A file that exists and cannot be USED is a PROBLEM, never a silent skip: a
 * `.p12` the password does not open would fail the build outright, so it is
 * reported and the key stays unset. Nothing here logs or throws; the caller
 * speaks.
 *
 * There is no provisioning profile: Developer ID direct distribution needs
 * none (the certificates walk requests none for those types, #891), so nothing
 * derives one.
 */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { findBrandRoot } = require('@omega.js/config');

const { signingTree } = require('./signing-tree.js');

// Tree-relative paths, the ONE home of both: the certificates walk writes them
// here and every reader asks this module for them.
const CERT_REL = join('certificates', 'DEVELOPER_ID_APPLICATION_G2.p12');
const authKeyRel = (keyId) => `AuthKey_${keyId}.p8`;

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
 * @param {string} p12Path - Path to the .p12.
 * @param {string} password - Candidate password.
 * @returns {{ opens: boolean, tooling?: string }} - tooling set when openssl
 *   itself was unavailable/unusable, so the caller can say so instead of
 *   blaming the password.
 */
function opensWith(p12Path, password) {
  // Password rides an env var, never argv, never a shell string.
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

/** An env value that is really set (an empty placeholder reads as unset). */
function isSet(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Derive the signing paths this target's tree implies. MUTATES `env`.
 *
 * @param {object} input
 * @param {object} input.env - The env map to derive into (the process env).
 * @param {string} input.targetDir - The target root; its brand names the tree.
 * @returns {{ derived: Array<{ key: string, value: string }>, problems: Array<{ key: string, reason: string }> }}
 *   `derived` is what was written (absolute tree paths); `problems` are files
 *   that exist and cannot be used. Both empty outside a brand.
 */
function deriveSigningEnv({ env, targetDir }) {
  const derived = [];
  const problems = [];

  // Outside a brand there is no tree, so there is nothing to derive.
  const brandRoot = findBrandRoot(targetDir);
  if (!brandRoot) {
    return { derived, problems };
  }

  const tree = signingTree({ brandRoot });

  // CSC_LINK: the Developer ID Application certificate.
  if (!isSet(env.CSC_LINK)) {
    const found = tree.find(CERT_REL);

    if (found) {
      if (!isSet(env.CSC_KEY_PASSWORD)) {
        problems.push({ key: 'CSC_LINK', reason: `${found.path} is there but CSC_KEY_PASSWORD is unset, so it cannot be opened` });
      } else {
        const check = opensWith(found.path, env.CSC_KEY_PASSWORD);

        if (check.tooling) {
          problems.push({ key: 'CSC_LINK', reason: `${check.tooling}, so ${found.path} cannot be verified` });
        } else if (!check.opens) {
          problems.push({ key: 'CSC_LINK', reason: `CSC_KEY_PASSWORD does not open ${found.path}` });
        } else {
          env.CSC_LINK = found.path;
          derived.push({ key: 'CSC_LINK', value: found.path });
        }
      }
    }
  }

  // APPLE_API_KEY: the App Store Connect key, whose FILENAME carries the id,
  // so an unset APPLE_API_KEY_ID means there is no path to look for.
  if (!isSet(env.APPLE_API_KEY) && isSet(env.APPLE_API_KEY_ID)) {
    const found = tree.find(authKeyRel(env.APPLE_API_KEY_ID.trim()));

    if (found) {
      env.APPLE_API_KEY = found.path;
      derived.push({ key: 'APPLE_API_KEY', value: found.path });
    }
  }

  return { derived, problems };
}

/**
 * Where each derivable key WOULD read from, whether or not the file is there:
 * the line a refusal names instead of asking an operator to paste a path.
 *
 * @param {object} input
 * @param {object} input.env - The env map (APPLE_API_KEY_ID names the AuthKey file).
 * @param {string} input.targetDir - The target root.
 * @returns {Array<{ key: string, paths: string[] }>} Absolute candidate paths,
 *   company tier first. Empty outside a brand.
 */
function signingPathCandidates({ env, targetDir }) {
  const brandRoot = findBrandRoot(targetDir);
  if (!brandRoot) {
    return [];
  }

  const { readDirs } = signingTree({ brandRoot });

  return [
    { key: 'CSC_LINK', rel: CERT_REL },
    { key: 'APPLE_API_KEY', rel: isSet(env.APPLE_API_KEY_ID) ? authKeyRel(env.APPLE_API_KEY_ID.trim()) : null },
  ]
    .filter((candidate) => candidate.rel)
    .map(({ key, rel }) => ({ key, paths: readDirs.map((dir) => join(dir, rel)) }));
}

module.exports = { deriveSigningEnv, signingPathCandidates, opensWith, CERT_REL };

// Validate code-signing prerequisites (certs, env vars).
//
// Runs as the `omega deploy` precheck and inside `omega publish`, both STRICT
// ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): a deploy is how
// a signed, notarized release ships, so missing material stops it. Standalone
// (`npx omega validate-certs`) it reports and exits 0 unless `--strict`.
//
// It READS the env, it never derives: the boot populated `CSC_LINK` and
// `APPLE_API_KEY` from the signing tree through the ONE derivation
// (utils/load-env.js, `@omega.js/devkit/signing-env`), so this step and the
// build that follows it judge the same answer. Scanning `config/certs/` for a
// file nothing pointed at is exactly the second rule that stopped a deploy the
// build would have signed fine, and it is gone.
//
// The mac rungs run on the MAC LEG and nowhere else
// ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): the linux and
// windows legs of the build workflow blank `CSC_LINK` and `APPLE_API_KEY` on
// purpose, because neither can sign for mac, so checking them there only
// printed two warnings about material nobody put on that leg. What is an ERROR
// vs a warning, once the run IS the mac leg:
//   error    no signing certificate at all, no Keychain identity on the leg that
//            has no CSC_LINK, a .p12 whose password is missing, an EXPIRED
//            certificate
//   warning  a certificate with under 30 days left (it still signs)
//
// Expiry is read by the ONE reader every surface uses (`@omega.js/devkit/certs`
// certificateExpiry, #892), so the manager's certificates walk and this step
// answer with the same date and the same three rungs.
//
// Exit codes:
//   0  all checks passed
//   1  failures (only when --strict is passed; otherwise we always exit 0 and just warn)

const path = require('path');
const jetpack = require('fs-jetpack');
const { execute } = require('node-powertools');
const { certificateExpiry, EXPIRY_WARN_DAYS } = require('@omega.js/devkit/certs');
const { signingPathCandidates } = require('@omega.js/devkit/signing-env');
const { requiredWhenHolds } = require('@omega.js/config/env-rules');

const build = require('../build.js');
const logger = build.logger('validate-certs');

module.exports = async function (options) {
  options = options || {};
  const strict = options.strict === true || (options._ && options._.includes('--strict'));

  logger.log('Validating signing prerequisites...');

  const platform = process.platform;
  const config = build.getConfig();
  const winStrategy = build.getWindowsSignStrategy();

  const issues = [];

  // The mac rungs, on the mac leg only (#891): checkMac itself says so and
  // prints the skip line off darwin.
  await checkMac(issues, config);

  if (platform === 'win32') {
    checkWindows(issues, winStrategy, config);
  }

  // Report.
  if (issues.length === 0) {
    logger.log(logger.format.green('All signing prerequisites OK.'));
    return { ok: true };
  }

  for (const issue of issues) {
    if (issue.severity === 'error') {
      logger.error(`✗ ${issue.message}`);
    } else {
      logger.warn(`⚠ ${issue.message}`);
    }
  }

  if (strict && issues.some((i) => i.severity === 'error')) {
    throw new Error(`${issues.length} validation issue(s) — see above.`);
  }

  return { ok: false, issues };
};

/**
 * The mac rungs, in order: the certificate, the notarization key, the team id,
 * and the Keychain identity the build falls back to when the env names no
 * certificate at all. DARWIN ONLY (#891): no other leg ships mac, and the
 * credentials are blanked on the ones that do not.
 *
 * @param {object[]} issues - The run's issue list, appended to.
 * @param {object} config - The resolved omega config.
 * @param {object} [options] - `{ execFn }`, the Keychain query seam.
 */
async function checkMac(issues, config, options = {}) {
  if (process.platform !== 'darwin') {
    logger.log('Skipping the macOS signing checks: this leg does not ship mac.');
    return;
  }

  const projectRoot = process.cwd();
  const execFn = options.execFn || execute;

  // The gate the env schema already uses for the whole mac set (its
  // `requiredWhen`): a brand that DECLARES Apple signing owes these
  // credentials, so a missing one is an error on the leg that signs (#891). A
  // brand that declares none is simply unsigned, and every finding here is a
  // note instead, the Keychain rung included.
  const declaresApple = requiredWhenHolds(config || {}, 'certificates.providers.apple');
  const signs = declaresApple ? 'error' : 'warn';

  // 1. Developer ID Application .p12. The boot derived CSC_LINK from the
  // signing tree when the tree holds one, so an unset key here means the tree
  // does NOT, and the line names where it looked and the walk that fills it.
  const cscLink = process.env.CSC_LINK;
  if (cscLink) {
    checkSigningCert(issues, cscLink, projectRoot);
  } else {
    issues.push({ severity: signs, message: `CSC_LINK is not set${treeNote(projectRoot, 'CSC_LINK')}, so this build cannot be signed for macOS. Run \`omega manage --service certificates\` to produce the signing material.` });
  }

  // 2. Notarization API key (.p8): derived from the same tree, judged the same
  // way. The non-mac legs of the build workflow carry the base64 secret itself.
  const apiKeyEnv = process.env.APPLE_API_KEY;
  if (apiKeyEnv) {
    checkNotarizationKey(issues, apiKeyEnv, projectRoot);
  } else {
    issues.push({ severity: signs, message: `APPLE_API_KEY is not set${treeNote(projectRoot, 'APPLE_API_KEY')}, so this build cannot be notarized. Set APPLE_API_KEY_ID in the .env and run \`omega manage --service certificates\` to produce the key.` });
  }

  // 3. Apple Team ID format check
  const teamId = process.env.APPLE_TEAM_ID;
  if (teamId && !/^[A-Z0-9]{10}$/.test(teamId)) {
    issues.push({ severity: 'warn', message: `APPLE_TEAM_ID="${teamId}" doesn't match the expected 10-character format.` });
  }

  // 4. macOS Keychain identity: the NO-CSC_LINK path only. A CSC_LINK .p12 is
  // imported by electron-builder into its OWN temporary keychain, so the login
  // keychain says nothing about whether that build can sign. Asking it anyway
  // is what stopped a runner whose file rungs had both just passed (#891).
  // With no CSC_LINK, identity discovery IS the signer, so the missing identity
  // is the same finding an unset key is.
  if (!cscLink) {
    try {
      const out = await execFn('security find-identity -v -p codesigning', { log: false });
      const identities = String(out || '');
      if (!identities.includes('Developer ID Application')) {
        issues.push({ severity: signs, message: 'No "Developer ID Application" identity in the macOS Keychain, so a local signed build has nothing to sign with. Run `omega manage --service certificates` (it imports the .p12) or import it via Keychain Access.' });
      } else {
        logger.log(logger.format.green('✓ Keychain has Developer ID Application identity.'));
      }
    } catch (e) {
      issues.push({ severity: 'error', message: `Could not query the macOS Keychain: ${e.message}` });
    }
  } else {
    logger.log('CSC_LINK names the certificate, so electron-builder imports it into its own keychain: no Keychain identity is read.');
  }
}

/**
 * Where the derivation LOOKED for a key's file, as a clause to append to the
 * "not set" line. The paths are the signing tree's, company tier first, from
 * the ONE home of them; a target outside a brand has no tree and gets nothing.
 *
 * @param {string} projectRoot - The target root.
 * @param {string} key - 'CSC_LINK' or 'APPLE_API_KEY'.
 * @returns {string} ` (no file at <path> or <path>)`, or ''.
 */
function treeNote(projectRoot, key) {
  const candidate = signingPathCandidates({ env: process.env, targetDir: projectRoot })
    .find((entry) => entry.key === key);

  return candidate ? ` and no file at ${candidate.paths.join(' or ')}` : '';
}

/**
 * What a signing credential's env value CARRIES. Both of the mac ones take three
 * shapes: a path to the file, an https URL, or the file ITSELF as inline base64,
 * and the build workflow ships two of them, because only the mac job decodes the
 * base64 secrets to disk before the build
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)). Statting an inline
 * value as a path is what killed the linux leg: a base64 .p12 (or .p8) is
 * thousands of characters and the stat throws ENAMETOOLONG.
 *
 * @param {string} value - The raw env value (CSC_LINK, APPLE_API_KEY).
 * @param {string} projectRoot - The target root, for resolving a relative path.
 * @returns {{ kind: 'url'|'inline'|'file'|'unreadable', path?: string, exists?: boolean, reason?: string }}
 */
function describeCertRef(value, projectRoot) {
  if (/^https?:\/\//i.test(value)) {
    return { kind: 'url' };
  }

  const candidate = path.isAbsolute(value) ? value : path.join(projectRoot, value);

  let exists;
  try {
    exists = !!jetpack.exists(candidate);
  } catch (e) {
    // A value no filesystem can even answer for. Base64 is the known case (a
    // name past the OS limit); anything else is reported, never thrown.
    if (looksInline(value)) {
      return { kind: 'inline' };
    }
    return { kind: 'unreadable', reason: e.message };
  }

  if (!exists && looksInline(value)) {
    return { kind: 'inline' };
  }

  return { kind: 'file', path: candidate, exists };
}

// A value that is no path at all: one long unbroken run of characters. A real
// .p12/.p8 path is short and carries a separator; base64 carries neither.
function looksInline(value) {
  return value.length > 200 && !value.includes('/') && !value.includes(path.sep);
}

/**
 * Report on one credential reference, and hand the caller back what it turned out
 * to be so its OWN checks (the cert's password, the key's id and issuer) can run
 * whatever the shape is. A shape with no file skips the file check, because there
 * is no file. Null means it was already reported as a hard failure.
 *
 * @param {object[]} issues - The run's issue list, appended to.
 * @param {object} options - `{ key, value, projectRoot, describe }`.
 * @returns {object|null} the described reference, or null when it failed.
 */
function checkCertRef(issues, options) {
  const { key, value, projectRoot, describe } = options;
  const ref = describeCertRef(value, projectRoot);

  if (ref.kind === 'unreadable') {
    issues.push({ severity: 'error', message: `${key} could not be read as a path: ${ref.reason}` });
    return null;
  }

  if (ref.kind === 'file' && !ref.exists) {
    issues.push({ severity: 'error', message: `${key} points to a missing file: ${ref.path}` });
    return null;
  }

  if (ref.kind === 'inline') {
    logger.log(`${key} carries an inline base64 ${describe} (${value.length} chars), so there is no file to check.`);
  } else if (ref.kind === 'url') {
    logger.log(`${key} carries a ${describe} URL, so there is no file to check.`);
  }

  return ref;
}

/**
 * The Developer ID Application certificate (CSC_LINK), whatever shape it arrives
 * in. Only a file is checkable as a file; every shape still needs the password
 * that decrypts it.
 */
function checkSigningCert(issues, value, projectRoot) {
  const cert = checkCertRef(issues, { key: 'CSC_LINK', value, projectRoot, describe: 'certificate' });
  if (!cert) {
    return;
  }

  if (!process.env.CSC_KEY_PASSWORD) {
    issues.push({ severity: 'error', message: 'CSC_KEY_PASSWORD is not set, so the signing certificate cannot be opened and signing WILL fail.' });
    return;
  }

  if (cert.kind !== 'file') {
    return;
  }

  const rel = pathLabel(projectRoot, cert.path);

  // The same three rungs the manager's certificates walk reports, over the same
  // reader (#892): fine, under 30 days warns, expired errors.
  let expiry;
  try {
    expiry = certificateExpiry(cert.path, { password: process.env.CSC_KEY_PASSWORD });
  } catch (e) {
    issues.push({ severity: 'error', message: `${rel}: ${e.message}` });
    return;
  }

  const rung = expiryRung(rel, expiry);
  if (rung) {
    issues.push(rung);
    return;
  }

  logger.log(logger.format.green(`✓ Developer ID Application cert at ${rel} (expires ${expiry.expiresAt.toISOString().slice(0, 10)}, ${expiry.daysLeft} days)`));
}

/**
 * The App Store Connect API key (APPLE_API_KEY). Apple's filename convention is
 * `AuthKey_<KEY_ID>.p8`, so the id/filename cross-check only exists for a FILE:
 * an inline key has no filename. The id and the issuer are wanted either way,
 * because notarytool takes all three.
 */
function checkNotarizationKey(issues, value, projectRoot) {
  const apiKey = checkCertRef(issues, { key: 'APPLE_API_KEY', value, projectRoot, describe: 'key' });
  if (!apiKey) {
    return;
  }

  const keyId = process.env.APPLE_API_KEY_ID;
  const issuer = process.env.APPLE_API_ISSUER;
  const filenameKeyId = apiKey.kind === 'file' ? path.basename(apiKey.path).match(/AuthKey_([A-Z0-9]+)\.p8$/i)?.[1] : null;

  if (!keyId) {
    issues.push({ severity: 'warn', message: 'APPLE_API_KEY set but APPLE_API_KEY_ID is missing.' });
  } else if (filenameKeyId && filenameKeyId !== keyId) {
    issues.push({ severity: 'warn', message: `APPLE_API_KEY filename suggests key ID "${filenameKeyId}" but APPLE_API_KEY_ID is "${keyId}". Likely a typo.` });
  }

  if (!issuer) {
    issues.push({ severity: 'warn', message: 'APPLE_API_KEY set but APPLE_API_ISSUER is missing.' });
  }

  if (apiKey.kind === 'file') {
    logger.log(logger.format.green(`✓ Notarization API key at ${pathLabel(projectRoot, apiKey.path)}`));
  }
}

function checkWindows(issues, strategy, config) {
  logger.log(`Checking Windows signing prerequisites (strategy: ${strategy})...`);

  if (strategy === 'self-hosted' || strategy === 'local') {
    const tokenPath = process.env.WIN_EV_TOKEN_PATH;
    if (!tokenPath) {
      issues.push({ severity: 'error', message: 'Set WIN_EV_TOKEN_PATH to the EV token / certificate path.' });
      return;
    }
    if (!process.env.WIN_CSC_KEY_PASSWORD) {
      issues.push({ severity: 'warn', message: 'WIN_CSC_KEY_PASSWORD not set — signing will fail.' });
    }
    logger.log(logger.format.green(`✓ Windows EV token path present (strategy=${strategy}).`));
    return;
  }

  if (strategy === 'cloud') {
    // The same key sign-windows and the build read: a platform setting, so it
    // sits under `platforms`, never under `targets` (#872).
    const provider = config.platforms?.windows?.signing?.cloud?.provider;
    if (!provider) {
      issues.push({ severity: 'error', message: 'Cloud signing strategy selected but no provider set (platforms.windows.signing.cloud.provider in omega.json5).' });
      return;
    }
    const required = {
      azure:    ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT'],
      sslcom:   ['SSLCOM_USERNAME', 'SSLCOM_PASSWORD', 'SSLCOM_CREDENTIAL_ID'],
      digicert: ['DIGICERT_API_KEY', 'DIGICERT_KEYPAIR_ALIAS'],
    }[provider] || [];

    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      issues.push({ severity: 'error', message: `Missing cloud-signing env vars for ${provider}: ${missing.join(', ')}` });
      return;
    }
    logger.log(logger.format.green(`✓ Cloud signing provider "${provider}" configured.`));
    return;
  }

  issues.push({ severity: 'error', message: `Unknown Windows signing strategy: ${strategy}` });
}

/**
 * What to CALL a file in a message: target-relative when it sits inside the
 * target, absolute otherwise. The signing tree lives outside the target, so a
 * relative label there would be a run of `../` nobody can read.
 *
 * @param {string} projectRoot - The target root.
 * @param {string} filePath - Absolute path to the file.
 * @returns {string}
 */
function pathLabel(projectRoot, filePath) {
  const rel = path.relative(projectRoot, filePath);
  return rel.startsWith('..') ? filePath : rel;
}

/**
 * The ONE verdict on a date: expired errors, under the shared renewal window
 * warns, anything else is fine. The same three rungs the manager's certificates
 * walk prints, from the same constant (#892).
 *
 * @param {string} label - What the message names (a target-relative path).
 * @param {{ expiresAt: Date, daysLeft: number }|null} expiry
 * @returns {{ severity: 'error'|'warn', message: string }|null} null when it is fine.
 */
function expiryRung(label, expiry) {
  if (!expiry) {
    return null;
  }

  if (expiry.daysLeft < 0) {
    return { severity: 'error', message: `${label}: EXPIRED on ${expiry.expiresAt.toISOString().slice(0, 10)} (${Math.abs(expiry.daysLeft)} days ago). Run \`omega manage --service certificates\` to renew it.` };
  }

  if (expiry.daysLeft < EXPIRY_WARN_DAYS) {
    return { severity: 'warn', message: `${label}: expires in ${expiry.daysLeft} day(s), renew soon.` };
  }

  return null;
}

// Exported for tests.
module.exports.describeCertRef = describeCertRef;
module.exports.checkCertRef = checkCertRef;
module.exports.checkSigningCert = checkSigningCert;
module.exports.checkNotarizationKey = checkNotarizationKey;
module.exports.checkWindows = checkWindows;
module.exports.checkMac = checkMac;
module.exports.expiryRung = expiryRung;

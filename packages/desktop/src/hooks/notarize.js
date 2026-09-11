// Real macOS notarization implementation. Lives inside @omega.js/desktop — consumers can extend it via
// hooks/notarize/post.js (called after this completes successfully).
//
// Uses Apple's notarytool with the App Store Connect API key. Legacy Apple ID + app-specific
// password flow is deliberately NOT supported.
//
// Required env vars:
//   APPLE_API_KEY     — path to AuthKey_XXXXXXXXXX.p8 (set by @omega.js/desktop CI workflow from base64-encoded secret)
//   APPLE_API_KEY_ID  — 10-char Key ID (matches the XXXXXXXXXX in the filename)
//   APPLE_API_ISSUER  — issuer UUID from App Store Connect → Users and Access → Keys
//
// Skipped automatically when:
//   - building for a non-darwin platform
//   - any of the env vars above is missing (warns, doesn't fail — useful for dev builds without certs)
//   - the packaged app carries no Developer ID signature (#872): electron-builder
//     SKIPS signing when it finds no identity and leaves an ad-hoc signature
//     behind, and notarytool rejects one ("Failed to codesign your application"),
//     so a brand with a notarization key but no signing cert failed the whole
//     mac leg after a clean build

const path = require('path');
const fs   = require('fs');
const { execute } = require('node-powertools');
const Logger = require('../lib/logger');

const logger = new Logger('notarize');

module.exports = async function notarize(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appleApiKey    = process.env.APPLE_API_KEY;
  const appleApiKeyId  = process.env.APPLE_API_KEY_ID;
  const appleApiIssuer = process.env.APPLE_API_ISSUER;

  if (!appleApiKey || !appleApiKeyId || !appleApiIssuer) {
    logger.warn('Skipping — set APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER to notarize.');
    return;
  }

  const apiKeyPath = path.isAbsolute(appleApiKey)
    ? appleApiKey
    : path.resolve(process.cwd(), appleApiKey);

  if (!fs.existsSync(apiKeyPath)) {
    throw new Error(`[notarize] APPLE_API_KEY file not found at ${apiKeyPath}`);
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  // Notarization verifies a Developer ID signature; an ad-hoc one (what
  // electron-builder leaves when it finds no identity) fails the submission
  // instead ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
  if (!isDeveloperIdSigned(await readCodesign(appPath))) {
    logger.warn(`Skipping: ${appName}.app is not Developer ID signed, so it cannot be notarized. Set CSC_LINK + CSC_KEY_PASSWORD (or install a Developer ID Application identity) to sign it first.`);
    return;
  }

  const { notarize } = require('@electron/notarize');

  logger.log(`Notarizing ${appName} via App Store Connect API key (${appleApiKeyId})...`);
  const start = Date.now();

  await notarize({
    tool:          'notarytool',
    appPath,
    appleApiKey:   apiKeyPath,
    appleApiKeyId,
    appleApiIssuer,
  });

  const duration = Math.round((Date.now() - start) / 1000);
  logger.log(`Done in ${duration}s.`);

  // After @omega.js/desktop's real notarization, optionally invoke the consumer's hooks/notarize/post.js as
  // an extension point. The consumer hook can do post-notarize work (custom stapling,
  // archiving, notifications, etc.). It is purely additive — @omega.js/desktop's real notarize always runs
  // first.
  const runConsumerHook = require('../utils/run-consumer-hook.js');
  await runConsumerHook('notarize/post', context);
};

// Pure: does codesign's own report describe a REAL Developer ID signature? An
// unsigned app has no report at all and an ad-hoc one ("Signature=adhoc",
// "TeamIdentifier=not set") carries no Authority line, so the one line
// notarization actually depends on is the one that is read.
function isDeveloperIdSigned(codesignOutput) {
  return /^Authority=Developer ID Application/m.test(String(codesignOutput || ''));
}

// codesign writes its report to STDERR and exits non-zero for an unsigned app,
// so the report is folded into stdout and a failure is read as the answer it is.
async function readCodesign(appPath, exec) {
  const run = exec || ((cmd) => execute(cmd, { log: false }));

  try {
    return String(await run(`codesign -dv --verbose=2 "${appPath}" 2>&1`) || '');
  } catch (e) {
    return String(e.message || '');
  }
}

// Exported for tests.
module.exports.isDeveloperIdSigned = isDeveloperIdSigned;
module.exports.readCodesign = readCodesign;

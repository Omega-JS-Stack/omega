// The DMG's own notarization, stapling and proof (electron-builder's
// `artifactBuildCompleted`, [#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
//
// The afterSign hook notarizes and staples the .app, and that ticket rides
// INSIDE the disk image, not on it: a user who downloads the .dmg has Gatekeeper
// assess the IMAGE first, and an unstapled image is refused on a Mac that is
// offline. So every .dmg this build produces is submitted with the same App
// Store Connect key, stapled, and PROVED (stapler validate + spctl --assess).
//
// Per artifact, not after all of them: electron-builder awaits this hook and
// THEN emits the `artifactCreated` its publisher uploads on, whereas
// `afterAllArtifactBuild` runs after every upload is already queued (run
// 34738410986 published a signed, notarized image with no staple that way).
//
// Non-mac legs produce no .dmg, so this hook is a no-op there by construction:
// it reads the artifact's extension, never the platform.

const fs = require('fs');
const path = require('path');
const Logger = require('@omega.js/devkit/logger');
const { submit, stapleAndProve, toolRunner } = require('./lib/notarize-tools.js');

const logger = new Logger('notarize-artifacts');

/**
 * @param {object} event - electron-builder's artifactBuildCompleted event
 *   (`{ file, target, arch, packager, ... }`).
 * @param {object} [options]
 * @param {function} [options.run] - Command runner (test seam for xcrun/spctl).
 * @returns {Promise<void>}
 */
module.exports = async function notarizeArtifacts(event, { run = toolRunner() } = {}) {
  const dmg = event.file;

  if (path.extname(dmg).toLowerCase() !== '.dmg') {
    return;
  }

  const apiKey    = process.env.APPLE_API_KEY;
  const apiKeyId  = process.env.APPLE_API_KEY_ID;
  const apiIssuer = process.env.APPLE_API_ISSUER;

  if (!apiKey || !apiKeyId || !apiIssuer) {
    throw new Error('[notarize] APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER are required to notarize the DMG. Run `omega deploy` (its precheck pushes them for CI) or set them in the target .env.');
  }

  const apiKeyPath = path.isAbsolute(apiKey) ? apiKey : path.resolve(process.cwd(), apiKey);
  if (!fs.existsSync(apiKeyPath)) {
    throw new Error(`[notarize] APPLE_API_KEY file not found at ${apiKeyPath}`);
  }

  logger.log(`Notarizing ${path.basename(dmg)} via App Store Connect API key (${apiKeyId})...`);
  await submit({ filePath: dmg, credentials: { apiKeyPath, apiKeyId, apiIssuer }, run });

  await stapleAndProve({ filePath: dmg, kind: 'dmg', run });
  logger.log(`Stapled and verified: stapler validate + spctl --assess both accept ${path.basename(dmg)}.`);
};

// Libraries
const Manager = new (require('../../build.js'));
const logger = Manager.logger('publish');
const chromeLogger = Manager.logger('publish:chrome');
const firefoxLogger = Manager.logger('publish:firefox');
const edgeLogger = Manager.logger('publish:edge');
const argv = Manager.getArguments();
const { series } = require('gulp');
const jetpack = require('fs-jetpack');
const path = require('path');
const { execute } = require('node-powertools');
const { amoMetadata } = require('./utils/amo.js');
const { listingId, listingConfigPath } = require('../../lib/listings.js');
const { FORMATS } = require('@omega.js/config');
const { shipPlan, missingShipKeys, shipKeyRefusal, listingManualStep } = require('@omega.js/devkit/ship-plan');

// Load package
const project = Manager.getPackage('project');

// Helper to parse browser filter from --browser flag or OMEGA_BROWSER env var
// Returns array of browser names to publish to, or null for all
function getBrowserFilter() {
  // Check env var first (works across npm && chains), then CLI arg
  const browser = process.env.OMEGA_BROWSER || argv.browser;

  // If true or undefined, publish to all
  if (browser === true || browser === undefined) {
    return null;
  }

  // If false, publish to none
  if (browser === false) {
    return [];
  }

  // If string, parse comma-separated list
  if (typeof browser === 'string') {
    return browser.split(',').map((b) => b.trim().toLowerCase());
  }

  return null;
}

// Paths per BUILD (#867): two of them, `chrome` and `firefox`, named in OMEGA's
// browser vocabulary. Edge publishes the chrome build, so it has no path of its
// own.
const PATHS = {
  chrome: {
    zip: path.join(process.cwd(), 'packaged', 'chrome', 'extension.zip'),
    raw: path.join(process.cwd(), 'packaged', 'chrome', 'raw'),
  },
  firefox: {
    zip: path.join(process.cwd(), 'packaged', 'firefox', 'extension.zip'),
    raw: path.join(process.cwd(), 'packaged', 'firefox', 'raw'),
  },
};

// Which BUILD each store uploads. Two builds, three stores: edge ships the
// chrome artifact, which is also the release asset its manual step names.
const BUILD = { chrome: 'chrome', firefox: 'firefox', edge: 'chrome' };

// The release asset a build is uploaded under (publishToGitHubRelease's name),
// so a manual step can point at a file that is already published.
function releaseAsset(browser) {
  return `extension-${BUILD[browser]}.zip`;
}

// This extension target's NAME (its folder under targets/), which is what a
// listing id is declared under in the brand config. A standalone project
// answers `extension`, the same fallback the release upload takes.
function targetName() {
  const { targetNameFromDir } = require('@omega.js/config');

  return targetNameFromDir(process.cwd()) || 'extension';
}

// The resolved config every store lane reads its listing id from (#893).
function resolveConfig(options) {
  return (options && options.config) || Manager.getConfig();
}

// The store's own id, or a refusal naming the ONE place it is declared. Chrome
// and Edge assign theirs when a human creates the listing, so nothing here can
// mint one: the fix is a paste into config (the manage walk asks for it, #867).
function requireListingId(config, browser, store) {
  const id = listingId(config, browser);

  if (!id) {
    throw new Error(`Missing the ${store} listing id: set ${listingConfigPath(targetName(), browser)} in config/omega.json5 (it is the id in the listing URL).`);
  }

  return id;
}

// The stores this task can talk to, for DISPLAY: the name and the pages a
// human visits. Whether a store ships at all is the brand's DECLARATION
// (#867), read in storeLanes below, and the name plus the console page come
// from @omega.js/config's format table so the walk that asks for the listing id
// and the step printed here name one page. Brave has no store of its own: it
// installs from the Chrome Web Store, so it is a NOTE, never a lane.
const STORES = {
  chrome: {
    name: FORMATS.extension.chrome.store.label,
    submitUrl: FORMATS.extension.chrome.store.console,
    apiUrl: 'https://developer.chrome.com/docs/webstore/using_webstore_api/',
  },
  firefox: {
    name: FORMATS.extension.firefox.store.label,
    submitUrl: FORMATS.extension.firefox.store.console,
    apiUrl: 'https://addons.mozilla.org/developers/addon/api/key/',
  },
  edge: {
    name: FORMATS.extension.edge.store.label,
    submitUrl: FORMATS.extension.edge.store.console,
    apiUrl: 'https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/api/using-addons-api',
  },
  brave: {
    name: 'Brave (via Chrome Web Store)',
    submitUrl: FORMATS.extension.chrome.store.console,
    apiUrl: null,
    note: 'Brave uses Chrome Web Store directly. Publishing to Chrome makes extension available in Brave.',
  },
};

/**
 * Which stores this publish uploads to, and which are left to a human
 * ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)).
 *
 * The brand's DECLARATION is the switch, not a credential's presence: a store
 * it kept is one it means to ship to, so a missing developer key is a refusal
 * (a half-credentialed store is a release that dies on a runner) and never a
 * store that quietly drops off the run. A store whose LISTING does not exist
 * yet is different in kind: nothing here can create one, so its zip rides the
 * GitHub release (already uploaded by the time this runs) and the manual step
 * says what a human does next.
 *
 * @param {object} [options]
 * @param {object} [options.config] - Resolved config (default: the consumer's).
 * @param {object} [options.env] - Env map (default: process.env).
 * @param {string} [options.target] - Target name (default: this target's folder).
 * @param {string[]} [options.browsers] - The `--browser` filter, when one was passed.
 * @returns {{ publish: string[], manual: string[] }} Browsers to publish to,
 *   and one printable line per store a human has to create the listing for.
 * @throws {Error} When a declared store has no developer key. Nothing uploads.
 */
function storeLanes(options) {
  options = options || {};

  const config = resolveConfig(options);
  const env = options.env || process.env;
  const target = options.target || targetName();

  const stores = shipPlan(config, 'extension')
    .filter((entry) => entry.kind === 'store')
    .filter((entry) => !options.browsers || options.browsers.includes(entry.platform));

  // The config's OWN requirements first: a half set publishes nothing (#891)
  const missing = missingShipKeys(stores, env);
  if (missing.length > 0) {
    throw new Error(shipKeyRefusal(missing));
  }

  const publish = [];
  const manual = [];

  for (const store of stores) {
    // A store with no `listing` needs nothing before it can accept an upload:
    // firefox addresses AMO with the manifest's gecko id (#893).
    if (store.listing.length > 0 && !listingId(config, store.platform)) {
      manual.push(listingManualStep({
        label: store.label,
        console: store.console,
        path: listingConfigPath(target, store.platform),
        asset: releaseAsset(store.platform),
      }));
      continue;
    }

    publish.push(store.platform);
  }

  return { publish, manual };
}

// Main publish task
async function publish(complete) {
  // Check if publish mode is enabled
  if (!process.env.OMEGA_IS_PUBLISH) {
    logger.log('Skipping publish (OMEGA_IS_PUBLISH not set)');
    return complete();
  }

  // Log
  logger.log('Starting publish...');

  // Check if zips exist for each target
  const missingZips = Object.entries(PATHS)
    .filter(([, paths]) => !jetpack.exists(paths.zip))
    .map(([target]) => target);

  if (missingZips.length > 0) {
    logger.error(`Extension zips not found for: ${missingZips.join(', ')}. Run build first.`);
    return complete();
  }

  // Log version
  logger.log(`Publishing version ${project.version}`);

  // The durable artifact channel goes FIRST, right off the zips (#883): it is
  // the one channel this brand owns, and it used to run after the store gate,
  // so a brand whose store lanes refuse (the throw below) or a single failed
  // store upload left the release repo with nothing at all. It is also what
  // makes the manual step below actionable: the zip a human uploads by hand to
  // a listing that does not exist yet is already published here.
  await publishToGitHubRelease();

  // Get browser filter from --browser flag
  const browserFilter = getBrowserFilter();

  // Log filter if applied
  if (browserFilter) {
    logger.log(`Browser filter: ${browserFilter.join(', ') || 'none'}`);
  }

  // What the DECLARATION says ships, minus the stores whose listing a human
  // still has to create. A declared store with no developer key throws here,
  // before a single upload (#867).
  const lanes = storeLanes({ browsers: browserFilter });

  for (const step of lanes.manual) {
    logger.warn(step);
  }

  const enabledStores = lanes.publish;

  if (enabledStores.length === 0) {
    if (browserFilter && browserFilter.length > 0) {
      logger.error(`No matching stores for --browser=${browserFilter.join(',')}. Available: chrome, firefox, edge`);
      throw new Error(`No matching stores for --browser=${browserFilter.join(',')}`);
    }

    // Every declared store is waiting on a human (or the brand declared none):
    // the zips are on the release either way, so this is a finished run.
    logger.log('No store to publish to: every declared store is waiting on a listing, or this brand declares none.');
    return complete();
  }

  logger.log(`Publishing to: ${enabledStores.join(', ')}`);

  // Track results
  const results = {
    success: [],
    failed: [],
  };

  // Run publish tasks in parallel
  const publishTasks = enabledStores.map(async (store) => {
    try {
      switch (store) {
        case 'chrome':
          await publishToChrome();
          break;
        case 'firefox':
          await publishToFirefox();
          break;
        case 'edge':
          await publishToEdge();
          break;
      }
      logger.log(`[${store}] Published successfully`);
      results.success.push(store);
    } catch (e) {
      logger.error(`[${store}] Publish failed: ${e.message}`);
      results.failed.push(store);
    }
  });

  await Promise.all(publishTasks);

  // Log completion and show all store URLs
  logger.log('');
  logger.log('Store URLs:');
  Object.entries(STORES).forEach(([key, store]) => {
    let status = '○ Manual';
    if (results.success.includes(key)) {
      status = '✓ Published';
    } else if (results.failed.includes(key)) {
      status = '✗ Failed';
    } else if (store.note) {
      status = `○ ${store.note.split('.')[0]}`; // First sentence of note
    }
    logger.log(`  ${store.name}: ${status}`);
    logger.log(`    Submit: ${store.submitUrl}`);
    if (store.apiUrl) {
      logger.log(`    API:    ${store.apiUrl}`);
    }
  });

  // Throw error if any failed
  if (results.failed.length > 0) {
    throw new Error(`Publish failed for: ${results.failed.join(', ')}`);
  }

  // Log
  logger.log('');
  logger.log('Publish finished!');

  // Complete
  return complete();
}

/**
 * Upload the built zips to the brand's ONE public releases repo
 * ([#883](https://github.com/Omega-JS-Stack/omega/issues/883)).
 *
 * Artifact channel = GitHub releases (D9 addendum 2): the same channel desktop
 * distributes installers through, and where the site's download links point.
 * Store uploads happen above for every store the brand DECLARES (#867); these
 * zips are the durable, downloadable fallback, and the one a human uploads by
 * hand to a store whose listing does not exist yet.
 *
 * It runs HERE rather than as a shell block in the scaffolded workflow: the
 * repo is DERIVED (`<brand.id>-releases` under `repo.org`), so no YAML types a
 * repo name, and a laptop publish and a CI publish do the same thing. The tag
 * is namespaced by TARGET (`<target name>-v<version>`), so a brand shipping two
 * extensions gets one release per target on the one repo.
 *
 * The build writes one zip per browser target (packaged/<target>/extension.zip)
 * and a release asset is named by its basename, so each is copied to a
 * target-stamped name before upload instead of clobbering the others.
 *
 * @param {object} [options]
 * @param {object} [options.config] - Resolved config (default: the consumer's).
 * @param {string} [options.version] - Version to tag (default: the project's).
 * @param {string} [options.target] - Target name (default: this target's folder, else `extension`).
 * @param {function} [options.execFn] - Injectable `gh` exec (tests).
 * @returns {Promise<{ repo: string, tag: string, assets: string[] }>} What was published.
 */
async function publishToGitHubRelease(options) {
  options = options || {};

  const { gh } = require('@omega.js/devkit/github-repo');
  const { releasesRepo, targetNameFromDir } = require('@omega.js/config');

  const config = options.config || Manager.getConfig();
  const releases = releasesRepo(config);

  // Half an address publishes nowhere: this is the address a download button on
  // the site is already pointing at, so it is named, never guessed.
  if (!releases) {
    throw new Error('Cannot address the releases repo: set repo.org (and brand.id) in config/omega.json5. The releases repo is `<brand.id>-releases` under that org.');
  }

  const version = options.version || project.version;
  const target = options.target || targetNameFromDir(process.cwd()) || 'extension';
  const tag = `${target}-v${version}`;
  const run = (args) => gh([...args, '--repo', releases.slug], { execFn: options.execFn });
  const commit = process.env.GITHUB_SHA ? ` (built from ${process.env.GITHUB_SHA})` : '';

  logger.log(`Uploading packages to ${releases.slug} (${tag})...`);

  // `release view` exits non-zero on a tag with no release yet: that IS the
  // "create it" answer, and every other failure surfaces from the create below.
  try {
    run(['release', 'view', tag]);
  } catch (e) {
    run(['release', 'create', tag, '--title', `Extension v${version}`, '--notes', `Browser extension package for v${version}${commit}.`]);
  }

  const assets = [];
  for (const name of Object.keys(PATHS)) {
    const asset = path.join(process.cwd(), 'packaged', `extension-${name}.zip`);
    jetpack.copy(PATHS[name].zip, asset, { overwrite: true });
    run(['release', 'upload', tag, asset, '--clobber']);
    assets.push(asset);
  }

  logger.log(`Uploaded ${assets.length} package(s) to ${releases.slug} ${tag}`);

  return { repo: releases.slug, tag, assets };
}

/**
 * Publish to the Chrome Web Store.
 *
 * The item id comes from config (`targets.<name>.listings.chrome.id`, #893)
 * and the API credential from `.env`: the id is in the listing URL every user
 * sees, the credential is a secret.
 *
 * @param {object} [options]
 * @param {object} [options.config] - Resolved config (default: the consumer's).
 * @param {function} [options.executeFn] - Injectable shell exec (tests).
 * @returns {Promise<void>}
 */
async function publishToChrome(options) {
  options = options || {};

  const run = options.executeFn || execute;

  // Get credentials from env
  const clientId = process.env.CHROME_CLIENT_ID;
  const clientSecret = process.env.CHROME_CLIENT_SECRET;
  const refreshToken = process.env.CHROME_REFRESH_TOKEN;

  // Validate
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Chrome credentials. Set CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN in .env');
  }

  const extensionId = requireListingId(resolveConfig(options), 'chrome', 'Chrome Web Store');

  chromeLogger.log('Uploading to Chrome Web Store...');

  // Use chrome-webstore-upload-cli with the chrome build
  const command = [
    'npx chrome-webstore-upload-cli',
    `--source "${PATHS.chrome.zip}"`,
    `--extension-id "${extensionId}"`,
    `--client-id "${clientId}"`,
    `--client-secret "${clientSecret}"`,
    `--refresh-token "${refreshToken}"`,
  ].join(' ');

  await run(command);

  chromeLogger.log('Upload complete');
}

/**
 * The gecko id of the firefox artifact this publish signs.
 *
 * AMO uses the manifest's `browser_specific_settings.gecko.id` as the add-on's
 * GUID, so the id a first publish creates the listing under is known before it
 * runs ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)). The
 * package task puts the config's `listings.firefox.id` there when the brand
 * declares one and derives it from the brand facts otherwise, so this reads
 * the artifact rather than re-deriving anything.
 *
 * @returns {string} The id, or '' when the artifact declares none.
 */
function packagedGeckoId() {
  const manifest = jetpack.read(path.join(PATHS.firefox.raw, 'manifest.json'), 'json');

  return manifest?.browser_specific_settings?.gecko?.id || '';
}

/**
 * Publish to Firefox Add-ons (AMO).
 *
 * A FIRST publish (no `listings.firefox.id` in config) is the one that CREATES
 * the listing, and AMO refuses to create one without a summary, a category and
 * a license ([#884](https://github.com/Omega-JS-Stack/omega/issues/884)): the
 * credentials-only call came back "Bad Request" after a green build. So that
 * publish writes the three fields to `.temp/amo-metadata.json` and hands the
 * path to `web-ext sign` as `--amo-metadata`. Every UPDATE passes no metadata:
 * AMO reuses the listing the first version made, addressed by the packaged
 * manifest's gecko id (web-ext's sign has no `--id` option; it reads the id
 * from `--source-dir`).
 *
 * Nothing is written back ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)):
 * this runs on the runner's throwaway checkout of the mirror, so a config write
 * here never reached the brand tree and every deploy created the add-on again.
 * The id is the brand's own derived value, pinned into config/omega.json5 on
 * the laptop by the local scaffold (commands/lib/ensure-target.js).
 *
 * @param {object} [options]
 * @param {object} [options.config] - Resolved config (default: the consumer's).
 * @param {function} [options.executeFn] - Injectable shell exec (tests).
 * @returns {Promise<void>}
 */
async function publishToFirefox(options) {
  options = options || {};

  const run = options.executeFn || execute;
  const config = resolveConfig(options);

  // Get credentials from env
  const apiKey = process.env.FIREFOX_API_KEY;
  const apiSecret = process.env.FIREFOX_API_SECRET;
  const channel = process.env.FIREFOX_CHANNEL || 'listed';

  // Validate
  if (!apiKey || !apiSecret) {
    throw new Error('Missing Firefox credentials. Set FIREFOX_API_KEY, FIREFOX_API_SECRET in .env');
  }

  // A declared listing id means the listing EXISTS: this is an update. The
  // artifact's gecko id is the same value when one is declared (the package
  // task writes it there), and on a first publish it is the guid AMO will
  // assign, so one id addresses both cases.
  const listed = listingId(config, 'firefox');
  const extensionId = listed || packagedGeckoId();

  if (!extensionId) {
    throw new Error(`Cannot address the Firefox listing: the packaged manifest carries no browser_specific_settings.gecko.id. Declare ${listingConfigPath(targetName(), 'firefox')} in config/omega.json5 and rebuild.`);
  }

  // The listing metadata, composed only where it is needed: the first publish.
  // The license is the target package.json's own `license` field, which every
  // OMEGA scaffold writes as UNLICENSED (AMO's `all-rights-reserved`).
  let metadataPath = '';

  // Log what we're doing
  if (listed) {
    firefoxLogger.log(`Updating existing add-on: ${extensionId}`);
  } else {
    firefoxLogger.log(`Creating new add-on as ${extensionId} (no ${listingConfigPath(targetName(), 'firefox')} in config)`);

    const metadata = amoMetadata({
      config,
      license: project.license,
      warn: (line) => firefoxLogger.warn(line),
    });

    metadataPath = path.join(process.cwd(), '.temp', 'amo-metadata.json');
    jetpack.write(metadataPath, metadata);

    firefoxLogger.log(`Listing metadata: categories ${metadata.categories.join(', ')}, license ${metadata.version.license}`);
  }

  // Use web-ext sign with firefox build
  // --approval-timeout=0 to skip waiting for approval (can take minutes to hours)
  // --artifacts-dir to prevent leaving web-ext-artifacts folder in project root
  const artifactsDir = path.join(process.cwd(), '.temp', 'web-ext-artifacts');
  const command = [
    'npx web-ext sign',
    `--source-dir "${PATHS.firefox.raw}"`,
    `--artifacts-dir "${artifactsDir}"`,
    `--api-key "${apiKey}"`,
    `--api-secret "${apiSecret}"`,
    `--channel "${channel}"`,
    '--approval-timeout 0', // Don't wait for approval - it can take hours
    // No `--id`: web-ext's sign has no such option (run 34738385576 died on
    // "Unknown argument: id"); the packaged manifest's gecko id under
    // --source-dir is what addresses the listing, create and update alike.
    metadataPath ? `--amo-metadata "${metadataPath}"` : '',
  ].filter(Boolean).join(' ');

  await run(command);

  // Clean up artifacts dir
  jetpack.remove(artifactsDir);

  firefoxLogger.log('Upload complete (approval may take time)');
}

/**
 * Publish to Microsoft Edge Add-ons.
 *
 * The product id comes from config (`targets.<name>.listings.edge.id`, #893)
 * and the API credential from `.env`.
 *
 * @param {object} [options]
 * @param {object} [options.config] - Resolved config (default: the consumer's).
 * @returns {Promise<void>}
 */
async function publishToEdge(options) {
  options = options || {};

  // Get credentials from env
  const clientId = process.env.EDGE_CLIENT_ID;
  const apiKey = process.env.EDGE_API_KEY;

  // Validate
  if (!clientId || !apiKey) {
    throw new Error('Missing Edge credentials. Set EDGE_CLIENT_ID, EDGE_API_KEY in .env');
  }

  const productId = requireListingId(resolveConfig(options), 'edge', 'Microsoft Edge Add-ons');

  // Helper for Edge API requests
  const edgeHeaders = {
    'Authorization': `ApiKey ${apiKey}`,
    'X-ClientID': clientId,
  };

  // Helper to parse Edge API response (handles empty bodies)
  async function parseEdgeResponse(response, label) {
    const text = await response.text();
    edgeLogger.log(`${label} - Status: ${response.status}, Body: ${text || '(empty)'}`);

    if (!text) {
      return { status: response.status, data: null };
    }

    try {
      return { status: response.status, data: JSON.parse(text) };
    } catch (e) {
      return { status: response.status, data: text };
    }
  }

  // Step 1: Upload the package first
  edgeLogger.log('Uploading to Microsoft Edge Add-ons...');

  const zipBuffer = jetpack.read(PATHS.chrome.zip, 'buffer');
  const uploadUrl = `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions/draft/package`;

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...edgeHeaders,
      'Content-Type': 'application/zip',
    },
    body: zipBuffer,
  });

  const upload = await parseEdgeResponse(uploadResponse, 'Upload response');

  if (!uploadResponse.ok) {
    throw new Error(`Edge upload error: ${upload.status} - ${JSON.stringify(upload.data)}`);
  }

  edgeLogger.log('Package uploaded, submitting for review...');

  // Step 2: Submit for review - this is where we'll get InProgressSubmission if there's a pending review
  const publishUrl = `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions`;
  const publishResponse = await fetch(publishUrl, {
    method: 'POST',
    headers: {
      ...edgeHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      notes: `Automated publish of version ${project.version}`,
    }),
  });

  const publish = await parseEdgeResponse(publishResponse, 'Publish response');

  // Check for HTTP errors (4xx, 5xx)
  if (!publishResponse.ok) {
    // Check if it's a 409 Conflict or similar indicating in-progress submission
    if (publish.status === 409) {
      throw new Error('Extension already has a pending submission in review. Wait for it to complete before publishing again.');
    }
    throw new Error(`Edge publish error: ${publish.status} - ${JSON.stringify(publish.data)}`);
  }

  // Check for API-level failures (HTTP 200/202 but status: "Failed" in body)
  if (publish.data && typeof publish.data === 'object') {
    if (publish.data.status === 'Failed') {
      if (publish.data.errorCode === 'InProgressSubmission') {
        throw new Error('Extension already has a pending submission in review. Wait for it to complete before publishing again.');
      }
      if (publish.data.errorCode === 'UnpublishInProgress') {
        throw new Error('Extension is being unpublished. Wait for unpublish to complete before publishing.');
      }
      throw new Error(`Edge publish failed: ${publish.data.message || publish.data.errorCode || 'Unknown error'}`);
    }
  }

  // HTTP 202 Accepted means submission was queued successfully
  if (publish.status === 202) {
    edgeLogger.log('Submission accepted and queued for review');
  }

  edgeLogger.log('Upload complete');
}

// Export task
module.exports = series(publish);
module.exports.storeLanes = storeLanes;
module.exports.publishToGitHubRelease = publishToGitHubRelease;
module.exports.publishToChrome = publishToChrome;
module.exports.publishToFirefox = publishToFirefox;
module.exports.publishToEdge = publishToEdge;

/**
 * Self-host Firebase's OAuth helper files into the built site: /__/auth/*
 * plus /__/firebase/init.json, fetched from {projectId}.firebaseapp.com at
 * production build time (UJM fetchFirebaseAuth parity). This is what lets
 * authDomain be the BRAND host on static hosting with no proxy (GitHub
 * Pages): the sign-in redirect stays first-party — which keeps
 * signInWithRedirect working under browser storage partitioning — and
 * /__/auth/handler resolves on the site domain instead of 404ing.
 *
 * Skips (logged, not fatal): no cloud.config.projectId, a demo-* project
 * (offline fixtures), or OMEGA_SKIP_FIREBASE_AUTH=true. A fetch FAILURE
 * fails the build loudly — a site shipped without the handler silently
 * breaks sign-in.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const jetpack = require('fs-jetpack');

// Extensionless handler/iframe are served as text/html by GitHub Pages.
// The iframe page references iframe.js relatively; the ?cb= rewrite busts
// the long-lived edge cache (the scaffolded Cloudflare cache rule pins
// /__/auth/iframe.js for a year). The breaker is a HASH of the fetched
// iframe.js content — it changes exactly when Firebase ships a new helper,
// and stays stable (cache-friendly, idempotent builds) when they don't.
const HELPER_FILES = [
  { remote: '__/auth/handler' },
  { remote: '__/auth/handler.js' },
  { remote: '__/auth/experiments.js' },
  { remote: '__/auth/iframe' },
  { remote: '__/auth/iframe.js' },
  { remote: '__/firebase/init.json' },
];

const IFRAME_PAGE = '__/auth/iframe';
const IFRAME_SCRIPT = '__/auth/iframe.js';
const IFRAME_SRC_MARKER = 'src="iframe.js"';

const TRIES = 3;

/**
 * Fetch one helper file with retries.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        // A 4xx from the static helper host is not transient (wrong project
        // id, helper path gone) — fail fast; retry only network errors + 5xx.
        error.permanent = response.status >= 400 && response.status < 500;
        throw error;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (error.permanent) {
        break;
      }
    }
  }
  throw new Error(`Failed to fetch Firebase auth helper ${url}: ${lastError.message}`);
}

/**
 * Fetch the Firebase auth helper files into the built site.
 * @param {object} options
 * @param {object} options.siteData - resolved omega config shape (reads cloud.config.projectId)
 * @param {string} options.outDir - built-site output dir
 * @param {object} options.logger - devkit logger
 * @param {string} [options.baseUrl] - source origin override (tests serve the fixture files locally)
 * @returns {Promise<{ skipped: string|false }>}
 */
async function fetchFirebaseAuthHelpers(options) {
  const { siteData, outDir, logger } = options;
  const projectId = siteData.cloud && siteData.cloud.config && siteData.cloud.config.projectId;

  if (process.env.OMEGA_SKIP_FIREBASE_AUTH === 'true') {
    logger.warn('firebase-auth: skipped via OMEGA_SKIP_FIREBASE_AUTH — sign-in redirects will 404 on this build');
    return { skipped: 'env' };
  }
  if (!projectId) {
    logger.log('firebase-auth: no cloud.config.projectId — helper files skipped');
    return { skipped: 'no-project' };
  }
  if (projectId.startsWith('demo-')) {
    logger.log(`firebase-auth: offline project ${projectId} — helper files skipped`);
    return { skipped: 'demo-project' };
  }

  const base = options.baseUrl || `https://${projectId}.firebaseapp.com`;

  // Fetch everything first — the iframe rewrite needs iframe.js' content
  const contents = new Map(await Promise.all(HELPER_FILES.map(async (file) => {
    const content = await fetchText(`${base}/${file.remote}`);
    return [file.remote, content];
  })));

  const scriptHash = crypto.createHash('md5').update(contents.get(IFRAME_SCRIPT)).digest('hex').slice(0, 8);
  const iframePage = contents.get(IFRAME_PAGE);
  if (iframePage.includes(IFRAME_SRC_MARKER)) {
    contents.set(IFRAME_PAGE, iframePage.replace(IFRAME_SRC_MARKER, `src="iframe.js?cb=${scriptHash}"`));
  } else {
    // Firebase changed the iframe markup — the year-long edge cache on
    // iframe.js can now serve a stale script against a new handler.
    logger.warn(`firebase-auth: ${IFRAME_SRC_MARKER} not found in ${IFRAME_PAGE} — cache breaker NOT applied; check Firebase's helper markup`);
  }

  for (const [remote, content] of contents) {
    jetpack.write(path.join(outDir, remote), content);
  }

  logger.log(`firebase-auth: self-hosted ${HELPER_FILES.length} helper files from ${projectId}.firebaseapp.com → /__/`);
  return { skipped: false };
}

module.exports = { fetchFirebaseAuthHelpers, HELPER_FILES };

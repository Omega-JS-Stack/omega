const path = require('path');
const jetpack = require('fs-jetpack');
const { loadEmulatorPorts } = require('./setup-tests/emulator-config');

/**
 * Initialize firebase-admin for CLI commands.
 *
 * @param {object} options
 * @param {string} options.firebaseProjectPath - Project root (from main.firebaseProjectPath)
 * @param {boolean} options.emulator - Whether to target the local emulator
 * @returns {{ admin: object, projectId: string }}
 */
function initFirebase({ firebaseProjectPath, emulator }) {
  // Load the .env cascade so env vars like GCLOUD_PROJECT are available
  require('@omega.js/config').loadEnv(firebaseProjectPath);

  // Resolve firebase-admin the way Node does from the target root — deps live
  // on the ONE target manifest (src/dist pillar) and hoist to the target/brand/
  // monorepo node_modules; a legacy dist/node_modules still resolves too.
  const { createRequire } = require('node:module');
  const targetRequire = createRequire(path.join(firebaseProjectPath, 'package.json'));
  const admin = targetRequire('firebase-admin');

  // Already initialized
  if (admin.apps.length > 0) {
    const projectId = admin.apps[0].options.projectId || 'unknown';
    return { admin, projectId };
  }

  if (emulator) {
    // N7: a running emulator's published map wins (it may have bumped);
    // otherwise firebase.json/classic values.
    const { readPortsFile } = require('@omega.js/config');
    const emulatorPorts = { ...loadEmulatorPorts(firebaseProjectPath), ...(readPortsFile(firebaseProjectPath) || {}) };

    // Set emulator env vars so firebase-admin connects to emulator
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST
      || `127.0.0.1:${emulatorPorts.firestore}`;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST
      || `127.0.0.1:${emulatorPorts.auth}`;

    const projectId = resolveProjectId(firebaseProjectPath);

    admin.initializeApp({ projectId });

    return { admin, projectId };
  }

  // Production: use the authored service-account chain (target root → brand secrets)
  const { resolveServiceAccountPath } = require('../utils/stage-functions');
  const serviceAccountPath = resolveServiceAccountPath(firebaseProjectPath);
  if (!serviceAccountPath) {
    throw new Error(
      `Missing service-account.json (target root or the brand's .omega/secrets/)\n`
      + `  Download it from Firebase Console > Project Settings > Service Accounts`,
    );
  }

  const serviceAccount = JSON.parse(jetpack.read(serviceAccountPath));
  const projectId = serviceAccount.project_id;

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${projectId}.firebaseio.com`,
  });

  return { admin, projectId };
}

function resolveProjectId(projectDir) {
  // Try config/omega.json5 (resolved — a brand-level cloud.config counts)
  const { hasOmegaConfig, loadConfig } = require('@omega.js/config');
  if (hasOmegaConfig(projectDir)) {
    try {
      const config = loadConfig(projectDir, 'backend').config;
      if (config.cloud?.config?.projectId) {
        return config.cloud.config.projectId;
      }
    } catch (e) {
      // Fall through
    }
  }

  // Try .firebaserc
  const rcPath = path.join(projectDir, '.firebaserc');
  if (jetpack.exists(rcPath)) {
    try {
      const rc = JSON.parse(jetpack.read(rcPath));
      if (rc.projects?.default) {
        return rc.projects.default;
      }
    } catch (e) {
      // Fall through
    }
  }

  // Fallback to env
  return process.env.GCLOUD_PROJECT || 'demo-project';
}

module.exports = { initFirebase, resolveProjectId };

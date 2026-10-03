/**
 * The Firebase services a page loads on FIRST USE, never at boot: Firestore
 * and messaging. Each loader imports its SDK and creates the one instance;
 * `loadOnce` keeps its promise on the instance (`omega.loadFirebaseFirestore()`,
 * `omega.loadFirebaseMessaging()` in index.js), so each runs once per page.
 */

import { createLogger } from './logger.js';

const logger = createLogger('firebase');

/**
 * The instance's one promise of a service, memoized under `key`. A load that
 * fails is not kept: its caller gets the rejection, and the next call retries.
 * @param {object} omega - the client instance.
 * @param {string} key - where the instance keeps the promise.
 * @param {Function} load - the loader, handed the instance.
 * @returns {Promise<object|null>} the service instance.
 */
export function loadOnce(omega, key, load) {
  if (!omega.firebaseApp) {
    return Promise.reject(new Error('Firebase is not configured on this page: gate on omega.firebaseApp before loading a Firebase service'));
  }

  omega[key] = omega[key] || load(omega).catch((error) => {
    omega[key] = null;
    throw error;
  });

  return omega[key];
}

/**
 * Whether this browser can carry web push: a service worker and the Push API.
 * @returns {boolean} true when both are present.
 */
export function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof window !== 'undefined' && 'PushManager' in window;
}

/**
 * Import Firestore and create the instance. On a local stack the emulator is
 * connected here, before the instance is handed to any reader.
 * @param {object} omega - the client instance, its Firebase app created.
 * @returns {Promise<object>} the Firestore instance.
 */
export async function loadFirestore(omega) {
  const { initializeFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
  const firestore = initializeFirestore(omega.firebaseApp, {});

  if (omega._localStack()) {
    const port = omega._devPort('firestore');
    connectFirestoreEmulator(firestore, '127.0.0.1', port);
    logger.log(`Firestore connected to the emulator (:${port})`);
  }

  return firestore;
}

/**
 * Import messaging and create the instance, or null where the browser has no
 * service worker or push support: getMessaging() floats an unhandled
 * unsupported-browser rejection there.
 * @param {object} omega - the client instance, its Firebase app created.
 * @returns {Promise<object|null>} the Messaging instance, or null.
 */
export async function loadMessaging(omega) {
  if (!pushSupported()) {
    logger.warn('Service workers or push not available - Firebase Messaging disabled');
    return null;
  }

  const { getMessaging } = await import('firebase/messaging');

  return getMessaging(omega.firebaseApp);
}

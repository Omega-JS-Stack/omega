/**
 * Sandbox brand website entry — boots web-manager against the emulated sandbox
 * backend and exposes the hooks the cross-stack e2e driver (../../e2e/run.js) calls.
 *
 * Configuration mirrors apps/backend/functions/backend-manager-config.json
 * (demo-sandbox-brand, fake-by-design values). environment=development +
 * env.FIREBASE_EMULATOR_CONNECT makes web-manager connect to the local emulator
 * suite instead of live Firebase — the same switch UJM's serve task injects.
 */
import manager from 'web-manager';
import { createUserWithEmailAndPassword } from 'firebase/auth';

const CONFIGURATION = {
  environment: 'development',
  brand: {
    id: 'sandbox-brand',
    name: 'Sandbox Brand',
  },
  firebaseConfig: {
    apiKey: 'sandbox-api-key',
    authDomain: 'demo-sandbox-brand.firebaseapp.com',
    projectId: 'demo-sandbox-brand',
    storageBucket: 'demo-sandbox-brand.appspot.com',
    messagingSenderId: '111111111111',
    appId: '1:111111111111:web:1111111111111111111111',
  },
  env: {
    FIREBASE_EMULATOR_CONNECT: true,
  },
};

function setStatus(text) {
  const element = document.getElementById('status');
  if (element) {
    element.textContent = text;
  }
}

/**
 * Await one settled auth state ({ user, account, resolved }). Each call re-fetches
 * the account from Firestore — the driver polls this to observe the user doc
 * created by backend-manager's auth onCreate trigger.
 */
function authState() {
  return new Promise((resolve) => {
    manager.auth().listen({ once: true }, resolve);
  });
}

window.__omega = {
  isReady: false,
  initError: null,
  manager,

  // Signup is page-side in the real stack too: pages create the Firebase auth
  // user directly; BEM's auth onCreate trigger then creates the Firestore doc.
  signUp(email, password) {
    return createUserWithEmailAndPassword(manager.firebaseAuth, email, password)
      .then((credential) => credential.user.uid);
  },
  signIn(email, password) {
    return manager.auth().signInWithEmailAndPassword(email, password)
      .then((user) => user.uid);
  },
  signOut() {
    return manager.auth().signOut();
  },
  currentUser() {
    return manager.auth().getUser();
  },
  authState,
};

manager.initialize(CONFIGURATION)
  .then(() => {
    window.__omega.isReady = true;
    setStatus('ready');
  })
  .catch((error) => {
    window.__omega.initError = error.message;
    setStatus(`init error: ${error.message}`);
  });

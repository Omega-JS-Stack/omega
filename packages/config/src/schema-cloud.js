/**
 * Schema rules for `cloud.config`, the provider's web-app config. For firebase
 * it is the console's config verbatim: public by design (the web API key is no
 * secret), and every key the Firebase web SDK takes is typed.
 */

const FIREBASE_WEB_KEYS = {
  apiKey: 'The web API key the Firebase SDKs identify the project with. Public by design: it ships in every browser bundle.',
  authDomain: "The Firebase Auth domain: the BRAND host, where the web build self-hosts /__/auth/* (docs/shared/config.md → authDomain).",
  databaseURL: 'The Realtime Database URL, for a project that has one.',
  storageBucket: 'The default Cloud Storage bucket.',
  messagingSenderId: 'The Cloud Messaging sender id web push registers against.',
  appId: 'The Firebase web app id.',
  measurementId: 'The Google Analytics measurement id Firebase links to the web app.',
};

const CLOUD_CONFIG_RULES = [
  {
    path:        'cloud.config',
    type:        'object',
    required:    false,
    description: 'Provider app config. For firebase: the web-app config verbatim from the console. Public by design: the web API key is not a secret.',
  },
  {
    path:        'cloud.config.projectId',
    type:        'string',
    required:    false,
    description: 'Drives auth, emulator project selection, analytics uuidv5 namespace, remote-config URL fallbacks.',
  },
  ...Object.entries(FIREBASE_WEB_KEYS).map(([key, description]) => ({
    path:        `cloud.config.${key}`,
    type:        'string',
    required:    false,
    description,
  })),
];

module.exports = { CLOUD_CONFIG_RULES };

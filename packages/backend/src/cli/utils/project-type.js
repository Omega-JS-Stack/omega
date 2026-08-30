/**
 * Which SHAPE this backend target runs and deploys as
 * ([#584](https://github.com/Omega-JS-Stack/omega/issues/584)):
 * `firebase` — Cloud Functions, the default and what most brands are — or
 * `custom` — the same Express app listening on `PORT`, deployed to a
 * container host (Render & co). The switch is the brand's own config,
 * `targets.backend.projectType`, so ONE file decides it for the runtime
 * (`Manager.init`) and for the CLI alike.
 *
 * Custom mode takes three VERBS away, and FIREBASE_ONLY_VERBS is the one home
 * of that list: the Functions deploy, the local emulator, and the emulator test
 * run. It also takes away the Firebase-only ARTIFACTS those verbs read —
 * FIREBASE_ONLY_SCAFFOLD and FIREBASE_ONLY_SETUP_CHECKS are the one home of
 * that list ([#614](https://github.com/Omega-JS-Stack/omega/issues/614)).
 * Everything else — the routes, the schemas, the auth middleware, every
 * helper, and the rest of setup — is identical in both modes, which is the
 * whole point of the mode.
 */
const chalk = require('chalk').default;

const { hasOmegaConfig, loadConfig, backendProjectType } = require('@omega.js/config');

// verb → what replaces it in custom mode. A refusal that doesn't name the
// lane is just a wall.
const FIREBASE_ONLY_VERBS = {
  deploy: "a custom backend publishes through its host (Render & co) — put that command in this target's `deploy` script, which the brand-root `omega deploy` runs",
  serve: 'a custom backend runs its own server — `npm start` boots it on PORT',
  emulator: 'there are no Cloud Functions to emulate — `npm start` boots the server on PORT',
  test: "the emulator lane needs Cloud Functions — `npm test` runs this target's static suite",
};

// The files the scaffold writes ONLY for the Firebase lane: firebase.json
// (deploy targets + emulator config), and the rules sources firebase.json
// points at. A custom backend deploys through its host and has no emulator, so
// scaffolding these leaves a consumer files to delete
// ([#614](https://github.com/Omega-JS-Stack/omega/issues/614)). Skipped, never
// removed: an existing custom project keeps whatever it authored.
const FIREBASE_ONLY_SCAFFOLD = ['firebase.json', 'firestore.rules', 'database.rules.json'];

// The setup CHECKS that exist only for those artifacts — every check that
// reads or writes firebase.json, plus the ones that seed the rules and index
// files. Module names under src/cli/commands/setup-tests/, which is where the
// registry resolves them.
const FIREBASE_ONLY_SETUP_CHECKS = [
  'is-firebase-project',
  'firestore-rules-in-json',
  'firestore-indexes-in-json',
  'realtime-rules-in-json',
  'storage-rules-in-json',
  'remoteconfig-template-in-json',
  'emulator-config',
  'hosting-rewrites',
  'hosting-folder',
  'firestore-rules-file',
  'firestore-indexes-file',
  'firestore-indexes-required',
  'firestore-indexes-synced',
  'realtime-rules-file',
  'storage-rules-file',
];

/**
 * The project type of the backend target at `targetRoot`.
 *
 * A missing, unreadable or unparseable config reads 'firebase': that is the
 * default, so it changes nothing, and the config problem itself belongs to the
 * lane that loads it properly (the target checks), not to a shape question.
 *
 * @param {string} targetRoot - The backend target root.
 * @returns {'firebase'|'custom'}
 */
function resolveProjectType(targetRoot) {
  try {
    if (!hasOmegaConfig(targetRoot)) return 'firebase';
    return backendProjectType(loadConfig(targetRoot, 'backend').config);
  } catch {
    return 'firebase';
  }
}

/**
 * @param {string} targetRoot - The backend target root.
 * @returns {boolean} True when this backend runs as a custom server.
 */
function isCustomProject(targetRoot) {
  return resolveProjectType(targetRoot) === 'custom';
}

/**
 * The gate every Firebase-only verb opens with. When this target runs in
 * custom mode it prints the refusal — the mode, and the lane that replaces
 * this verb — fails the process, and returns true; the caller returns at once.
 *
 * The exit code matters: these verbs are chained in package scripts and fanned
 * out by the manager, and a refusal that read green would look like a deploy
 * that happened.
 *
 * @param {string} targetRoot - The backend target root.
 * @param {keyof FIREBASE_ONLY_VERBS} verb - The verb being refused.
 * @returns {boolean} True when the caller must stop.
 */
function refuseWhenCustom(targetRoot, verb) {
  if (!isCustomProject(targetRoot)) return false;

  console.log(chalk.yellow(`\n⊘ omega ${verb}: this backend runs \`projectType: 'custom'\` (config/omega.json5 → targets.backend) — ${FIREBASE_ONLY_VERBS[verb]}.`));
  process.exitCode = 1;
  return true;
}

module.exports = { resolveProjectType, isCustomProject, refuseWhenCustom, FIREBASE_ONLY_VERBS, FIREBASE_ONLY_SCAFFOLD, FIREBASE_ONLY_SETUP_CHECKS };

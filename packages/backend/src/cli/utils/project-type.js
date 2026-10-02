/**
 * Which SHAPE this backend target runs and deploys as
 * ([#584](https://github.com/Omega-JS-Stack/omega/issues/584)):
 * `firebase` — Cloud Functions, the default and what most brands are — or
 * `custom` — the same Express app listening on `PORT`, deployed to a
 * container host (Render & co). The switch is the brand's own config,
 * `targets.backend.projectType`, so ONE file decides it for the runtime
 * (`omega.initialize()`) and for the CLI alike.
 *
 * Custom mode takes the Firebase VERBS away, and FIREBASE_ONLY_VERBS is the one
 * home of that list: the Functions deploy and every verb that boots the local
 * emulator or hosting. It also takes away the Firebase-only ARTIFACTS those
 * verbs read — FIREBASE_ONLY_SCAFFOLD and FIREBASE_ONLY_SETUP_CHECKS are the one home of
 * that list ([#614](https://github.com/Omega-JS-Stack/omega/issues/614)) — and
 * the package SCRIPTS that run them, CUSTOM_OWNED_SCRIPTS, derived from the
 * verbs. A Firebase verb that runs a machine tool (java, the firebase CLI)
 * refuses through refuseWhenToolsMissing when the tool is absent.
 * Everything else — the routes, the schemas, the auth middleware, every
 * helper, and the rest of setup — is identical in both modes, which is the
 * whole point of the mode.
 */
const chalk = require('chalk').default;

const { hasOmegaConfig, loadConfig, backendProjectType, targetNameFromDir } = require('@omega.js/config');
const { projectScripts } = require('@omega.js/devkit/verb-scripts');
const { missingMachineTools, machineToolLine } = require('@omega.js/devkit/machine-tools');

// The framework's own manifest: its `projectScripts` are the target scripts the
// verb table cannot derive.
const frameworkPackage = require('../../../package.json');

// verb → what replaces it in custom mode. A refusal that doesn't name the
// lane is just a wall.
const FIREBASE_ONLY_VERBS = {
  deploy: "a custom backend publishes through its host (Render & co) — put that command in this target's `deploy` script, which the brand-root `omega deploy` runs",
  dev: "there are no Cloud Functions to emulate: this target's own `start` script boots the server on PORT, and the brand-root `omega dev` runs it",
  serve: 'a custom backend runs its own server — `npm start` boots it on PORT',
  emulator: 'there are no Cloud Functions to emulate — `npm start` boots the server on PORT',
};

/**
 * The omega verb a package script runs, or undefined when it runs none.
 *
 * @param {string} command - The script's command.
 * @returns {string|undefined}
 */
function verbOfCommand(command) {
  return (String(command).match(/(?:^|&& )omega (\S+)/) || [])[1];
}

// The target scripts a custom-server backend owns instead of the framework: every
// one whose command runs a verb this mode refuses (its own server, its own host deploy).
const CUSTOM_OWNED_SCRIPTS = Object.entries(projectScripts(frameworkPackage))
  .filter(([, command]) => FIREBASE_ONLY_VERBS[verbOfCommand(command)])
  .map(([key]) => key);

// The files the scaffold writes ONLY for the Firebase lane: firebase.json
// (deploy targets + emulator config), and the rules sources firebase.json
// points at. A custom backend deploys through its host and has no emulator, so
// scaffolding these leaves a consumer files to delete
// ([#614](https://github.com/Omega-JS-Stack/omega/issues/614)). Skipped, never
// removed: an existing custom project keeps whatever it authored.
const FIREBASE_ONLY_SCAFFOLD = ['firebase.json', 'firestore.rules', 'database.rules.json'];

// The setup CHECKS that exist only for that lane: every firebase.json check,
// the rules and index seeds, and the machine tools the emulators and the
// Functions deploy run on. Module names under src/cli/commands/setup-tests/,
// which is where the registry resolves them.
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
  'java-installed',
  'firebase-cli',
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
 * The package scripts THIS framework owns for the target at `targetRoot` — the
 * ONE home of the ownership semantics, read by both writers: the scaffold every
 * verb runs (ensure-target.js) and the setup check that holds a target to them
 * (setup-tests/npm-project-scripts.js).
 *
 * Every target script in firebase mode: the verb table's, the manifest's
 * declarations merged over them. In custom mode, all but the keys whose verbs
 * that mode refuses: those are the BRAND's (its own server command, its own host
 * deploy), so they are never written and never scaffolded.
 *
 * @param {string} targetRoot - The backend target root.
 * @returns {Object} Script key to the command this framework owns it as.
 */
function frameworkOwnedScripts(targetRoot) {
  const declared = projectScripts(frameworkPackage);
  if (!isCustomProject(targetRoot)) return declared;

  return Object.fromEntries(Object.entries(declared).filter(([key]) => !CUSTOM_OWNED_SCRIPTS.includes(key)));
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

/**
 * The machine tools the backend target at `targetRoot` misses, from devkit's
 * one list: a custom backend needs none.
 *
 * @param {string} targetRoot - The backend target root.
 * @returns {Array<object>} The missingMachineTools rows.
 */
function missingBackendTools(targetRoot) {
  return missingMachineTools([{ name: targetNameFromDir(targetRoot) || 'backend', type: 'backend', projectType: resolveProjectType(targetRoot) }]);
}

/**
 * The gate a verb that cannot run without a machine tool opens with: each
 * missing one of `names` prints its line, the process fails, and it returns
 * true; the caller returns at once.
 *
 * @param {string} targetRoot - The backend target root.
 * @param {string} verb - The verb being refused.
 * @param {string[]} names - The tools this verb runs.
 * @returns {boolean} True when the caller must stop.
 */
function refuseWhenToolsMissing(targetRoot, verb, names) {
  const misses = missingBackendTools(targetRoot).filter((miss) => names.includes(miss.name));
  if (misses.length === 0) return false;

  misses.forEach((miss) => console.log(chalk.yellow(`\n⊘ omega ${verb}: ${machineToolLine(miss)}`)));
  process.exitCode = 1;
  return true;
}

module.exports = { resolveProjectType, isCustomProject, refuseWhenCustom, missingBackendTools, refuseWhenToolsMissing, frameworkOwnedScripts, verbOfCommand, FIREBASE_ONLY_VERBS, FIREBASE_ONLY_SCAFFOLD, FIREBASE_ONLY_SETUP_CHECKS, CUSTOM_OWNED_SCRIPTS };

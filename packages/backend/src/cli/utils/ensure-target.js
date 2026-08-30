/**
 * ensure-target — the LOCAL, idempotent scaffold every verb runs
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * `omega setup` used to own this half and nothing ran it for you, so a target
 * drifted until someone remembered the command per target. It is retired: the
 * "write it if missing" steps live here and `ensureStaged()` calls this first,
 * so build/dev/serve/emulator/test/deploy all heal the tree on the way past.
 *
 * What it guarantees, in this order (config first — the derived artifacts read
 * it):
 *
 *   config/omega.json5      standalone targets only (inside a brand monorepo
 *                           the brand root's `targets.backend` IS the config)
 *   .firebaserc             derived from the resolved config's project id
 *   firebase.json           scaffolded, or migrated onto the src/dist pillar
 *   src/index.js            the AUTHORED Cloud Functions entry
 *   firestore.rules         the brand's rules SOURCE half (the stage compiles it)
 *   database.rules.json     the emulator dies ENOENT without it
 *   package.json engines    the FRAMEWORK's pinned Cloud Functions runtime
 *   src/defaults/**         the defaults tree (copy-if-missing; AGENTS.md and
 *                           .gitignore live-sync their Default section)
 *
 * Everything here is copy-if-missing or merge-in-place: a consumer file is
 * never clobbered, and a run that changes nothing writes nothing and says
 * nothing. Anything that needs the network is NOT here — that belongs to the
 * verb that needs it.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');
const omegaConfig = require('@omega.js/config');

const { scaffoldDefaults } = require('../../utils/scaffold-defaults.js');
const { isCustomProject, FIREBASE_ONLY_SCAFFOLD } = require('./project-type');

// The framework's own manifest — its `omega.functionsRuntime` is the pinned
// Cloud Functions runtime every consumer app inherits (SSOT with the .nvmrc
// lockstep in setup-tests/nvmrc-version.js). Deliberately decoupled from
// `engines.node`, which is the honest DEV floor (`>=22`): the cloud runtime
// is Firebase's to provide, the laptop only has to meet the floor.
const frameworkPackage = require('../../../package.json');

const TEMPLATES_DIR = path.resolve(__dirname, '../../../templates');

/** Read a JSON5 file, `{}` when it is missing or empty. */
function loadJSON(filePath) {
  const contents = jetpack.read(filePath);
  return contents ? JSON5.parse(contents) : {};
}

function hasContent(object) {
  return Object.keys(object).length > 0;
}

/**
 * The project id `.firebaserc` derives from.
 *
 * The config is the source of truth: a wizard-seeded brand carries
 * cloud.config.projectId (the demo-<id> convention) before any artifact
 * exists — .firebaserc derives from it, never the reverse.
 *
 * @param {string} projectDir - The target root.
 * @returns {string} The project id.
 */
function resolveProjectId(projectDir) {
  if (omegaConfig.hasOmegaConfig(projectDir) || omegaConfig.findBrandRoot(projectDir)) {
    try {
      const configured = omegaConfig.loadConfig(projectDir, 'backend').config.cloud?.config?.projectId;
      if (configured) {
        return configured;
      }
    } catch (e) {
      // Unloadable config — the omega-config target check reports it
    }
  }

  const saPath = path.join(projectDir, 'service-account.json');
  if (jetpack.exists(saPath)) {
    try {
      const sa = JSON.parse(jetpack.read(saPath));
      if (sa.project_id) {
        return sa.project_id;
      }
    } catch (e) {
      // Fall through
    }
  }

  return process.env.GCLOUD_PROJECT || 'demo-project';
}

/**
 * Scaffold the config artifacts a backend target cannot run without.
 *
 * @param {string} projectDir - The target root.
 * @param {{ written: string[], changed: string[] }} result - Collector.
 */
function scaffoldConfigs(projectDir, result) {
  // Custom mode has no Functions deploy and no emulator, so the Firebase-only
  // artifacts below are scaffolded away entirely (#614). The list lives with
  // the mode table, next to the verbs the same mode refuses.
  const custom = isCustomProject(projectDir);
  const skipsFirebaseFile = (file) => custom && FIREBASE_ONLY_SCAFFOLD.includes(file);

  // Config FIRST (friction #11: config → derived artifacts, so .firebaserc
  // below can read cloud.config.projectId). Inside a brand monorepo the target
  // carries NO omega.json5 at all — brand `targets.*` is the per-target home
  // (cp121c/cp122) and the stage step composes the runtime file. Standalone
  // consumers (no brand root above) get the full template at the TARGET ROOT —
  // the same escape hatch every other target uses.
  if (!omegaConfig.hasOmegaConfig(projectDir) && !omegaConfig.findBrandRoot(projectDir)) {
    jetpack.copy(path.join(TEMPLATES_DIR, 'config', 'omega.json5'), path.join(projectDir, 'config', 'omega.json5'));
    result.written.push('config/omega.json5');
  }

  // .firebaserc — DERIVED from the resolved config (else service account / env)
  if (!hasContent(loadJSON(path.join(projectDir, '.firebaserc')))) {
    const projectId = resolveProjectId(projectDir);
    jetpack.write(path.join(projectDir, '.firebaserc'), `${JSON.stringify({ projects: { default: projectId } }, null, 2)}\n`);
    result.written.push('.firebaserc');
  }

  // firebase.json — scaffold or migrate
  const firebaseJsonPath = path.join(projectDir, 'firebase.json');
  const firebaseJSON = loadJSON(firebaseJsonPath);
  if (skipsFirebaseFile('firebase.json')) {
    // Nothing: not even the dist/ migration below, which would rewrite a
    // file this mode never asked for.
  } else if (!hasContent(firebaseJSON)) {
    jetpack.copy(path.join(TEMPLATES_DIR, 'firebase.json'), firebaseJsonPath);
    result.written.push('firebase.json');
  } else {
    // Migrate legacy `functions` → `dist` (src/dist pillar): the functions
    // source and hosting public dir must point at the staged output tree.
    let dirty = false;
    const fnBlock = Array.isArray(firebaseJSON.functions) ? firebaseJSON.functions[0] : firebaseJSON.functions;
    if (fnBlock && fnBlock.source === 'functions') {
      fnBlock.source = 'dist';
      dirty = true;
    }
    if (firebaseJSON.hosting && firebaseJSON.hosting.public === 'public') {
      firebaseJSON.hosting.public = 'dist/public';
      dirty = true;
    }
    if (dirty) {
      jetpack.write(firebaseJsonPath, `${JSON.stringify(firebaseJSON, null, 2)}\n`);
      result.changed.push('firebase.json (functions source + hosting public → dist/)');
    }
  }

  // src/index.js — the AUTHORED Cloud Functions entry (src/dist pillar);
  // the stage step mirrors it into dist/index.js
  const indexPath = path.join(projectDir, 'src', 'index.js');
  if (!jetpack.exists(indexPath)) {
    jetpack.copy(path.join(TEMPLATES_DIR, 'index.js'), indexPath);
    result.written.push('src/index.js');
  }

  // firestore.rules — the brand's SOURCE half (#255). Seeded HERE, before the
  // stage compiles it, so a virgin target's first stage already has a real
  // source to splice the framework half into. Migration off a legacy marker
  // block + the hook lint belong to the firestore-rules-file check.
  const firestoreRulesPath = path.join(projectDir, 'firestore.rules');
  if (!skipsFirebaseFile('firestore.rules') && !jetpack.exists(firestoreRulesPath)) {
    jetpack.copy(path.join(TEMPLATES_DIR, 'firestore.rules'), firestoreRulesPath);
    result.written.push('firestore.rules');
  }

  // database.rules.json — firebase.json references it and the emulator dies
  // ENOENT without it (friction #9). The template ships the v0.0.0-stamped
  // marker block; the rules checks stamp the live version.
  const databaseRulesPath = path.join(projectDir, 'database.rules.json');
  if (!skipsFirebaseFile('database.rules.json') && !jetpack.exists(databaseRulesPath)) {
    jetpack.copy(path.join(TEMPLATES_DIR, 'database.rules.json'), databaseRulesPath);
    result.written.push('database.rules.json');
  }
}

/**
 * Stamp engines.node on the TARGET manifest — the stage step carries it into
 * the derived dist/package.json (Cloud Functions runtime detection). Derived
 * from the FRAMEWORK's pinned runtime, never the ambient node: a scaffold must
 * produce the same app under any shell (cp195 journey catch — an ambient-24
 * run stamped 24 against the v22/* .nvmrc and boot died on the Manager.init
 * version mismatch). A consumer-authored value is never overwritten.
 *
 * @param {string} projectDir - The target root.
 * @param {{ written: string[], changed: string[] }} result - Collector.
 */
function scaffoldPackageJson(projectDir, result) {
  const manifestPath = path.join(projectDir, 'package.json');
  const manifest = loadJSON(manifestPath);

  if (manifest.engines && manifest.engines.node) return;

  const nodeVersion = String(parseInt(frameworkPackage.omega.functionsRuntime, 10));
  manifest.engines = manifest.engines || {};
  manifest.engines.node = nodeVersion;
  jetpack.write(manifestPath, JSON.stringify(manifest, null, 2));
  result.changed.push(`package.json (engines.node = ${nodeVersion})`);
}

/**
 * Apply the framework's defaults tree (src/defaults/**) to the target root via
 * the shared devkit engine. The file map lives in src/utils/scaffold-defaults.js:
 * copy-if-missing for everything, marker-section merge (Default =
 * framework-owned, Custom = consumer-owned) for AGENTS.md and .gitignore.
 *
 * @param {string} projectDir - The target root.
 * @param {{ written: string[], merged: string[] }} result - Collector.
 */
function copyDefaults(projectDir, result) {
  const defaultsDir = path.resolve(__dirname, '../../defaults');

  // Optional — older @omega.js/backend versions shipped no defaults tree
  if (!jetpack.exists(defaultsDir)) return;

  const applied = scaffoldDefaults({
    outputDir: projectDir,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  result.written.push(...applied.written);
  result.merged.push(...applied.merged);
}

/**
 * Sweep the transient artifacts older runs left in the tree — today just the
 * reload trigger `npx omega watch` writes. Log sweeping belongs to the boot
 * lanes (base-command's sweepStaleLogs), which run it per boot.
 *
 * @param {string} projectDir - The target root.
 */
function cleanupGeneratedArtifacts(projectDir) {
  const triggerFile = path.join(projectDir, 'functions', 'omega-reload-trigger.js');
  if (jetpack.exists(triggerFile)) {
    jetpack.remove(triggerFile);
  }
}

/**
 * Make the target whole — idempotent, offline, and quiet when there is
 * nothing to do.
 *
 * @param {object} options
 * @param {string} options.projectDir - The target root.
 * @param {function} [options.log] - Line logger (silent by default).
 * @returns {{ written: string[], merged: string[], changed: string[] }}
 *   Target-relative paths per outcome — empty on a no-op run.
 */
function ensureTarget(options) {
  const projectDir = options.projectDir;
  const log = options.log || (() => {});
  const result = { written: [], merged: [], changed: [] };

  // The framework's own tree is not a consumer target. Running the framework's
  // suite from packages/backend puts the framework at the cwd, and a verb that
  // scaffolds unconditionally would scatter the consumer defaults through the
  // package. Refuse, quietly: this is a normal state, not a broken one.
  // (Sibling of the same guard in @omega.js/desktop's ensure-target.)
  if (loadJSON(path.join(projectDir, 'package.json')).name === frameworkPackage.name) {
    return result;
  }

  scaffoldConfigs(projectDir, result);
  scaffoldPackageJson(projectDir, result);
  copyDefaults(projectDir, result);
  cleanupGeneratedArtifacts(projectDir);

  for (const [label, files] of [['Created', result.written], ['Merged', result.merged], ['Synced', result.changed]]) {
    if (files.length > 0) log(`${label} ${files.join(', ')}`);
  }

  return result;
}

module.exports = { ensureTarget, resolveProjectId };

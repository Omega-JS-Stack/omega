/**
 * stage-functions — the backend consumer build step (src/dist pillar).
 *
 * `dist/` is GENERATED OUTPUT, staged fresh from the authored target tree:
 *
 *   src/**                → dist/**                 (1:1 copy, no transforms)
 *   package.json          → dist/package.json       (derived: name/engines/deps)
 *   config layers         → dist/config/omega.json5 (composeTargetConfig —
 *                           brand⊕local flattened; the deployed runtime cannot
 *                           walk up past the upload boundary, cp100e)
 *   env cascade           → dist/.env               (COMPOSED: composeTargetEnv —
 *                           company ← brand ← target, each layer overlaid by its
 *                           own .env.<environment> file, filtered to the keys the
 *                           env schema names for `backend`; the STAGE names the
 *                           environment, #586)
 *   .nvmrc                → dist/.nvmrc
 *   service-account.json  → dist/service-account.json (target root, else the
 *                           brand's .omega/secrets/ — the key's ONE home)
 *   src/public/** OR      → dist/public/**          (consumer overrides win;
 *   templates/public/**                               defaults fill the gaps)
 *   firestore.rules +     → dist/firestore.rules    (COMPILED: the brand's rules
 *   the framework half                                spliced with the framework's,
 *                                                     a matching brand match block
 *                                                     MERGED in — compile-rules.js)
 *
 * firebase.json references `dist` as both `functions.source` and
 * `hosting.public` (as `dist/public`), so one staged tree feeds every
 * Firebase surface.
 *
 * The stage is a full re-stage on every call (consumer src is small), with a
 * preserve list for runtime artifacts that live inside dist/ between stages:
 * node_modules/ (self-test symlinks, legacy installs) and *.log
 * (dev/emulator/test/deploy logs — co-located with firebase-tools' logs by
 * design, see docs/logging.md). Everything else is wiped first, so a file
 * deleted from src/ disappears from the stage and a stale composed config
 * can never shadow a brand edit.
 *
 * node_modules is NOT staged: local runs resolve up from dist/ to the target
 * root's install (plain Node resolution); deploys layer the devkit pack step
 * (packed file: deps + lockfile, cp100d's rule) on top of this stage.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const { composeTargetConfig, composeTargetEnv, artifactEnvValues, serializeEnv, resolveEnvChain, findBrandRoot, envLayerFiles, ENV_ENVIRONMENTS } = require('@omega.js/config');
const { compileFirestoreRules, COMPILED_RULES_FILE, BRAND_RULES_FILE } = require('./compile-rules');
const { isCustomProject } = require('./project-type');

// The framework's pinned Cloud Functions runtime — the engines fallback when
// a target manifest carries none (never the ambient node: staging must produce
// the same artifact under any shell)
const frameworkPackage = require('../../../package.json');

// dist/ entries that survive a re-stage (runtime artifacts, never authored)
const PRESERVE = [/^node_modules$/, /\.log$/];

const CONFIG_BANNER = '// Staged by `omega build` (brand+local config layers flattened for the runtime\n'
  + '// and the deploy upload boundary). GENERATED — edit the brand/local omega.json5.\n';

const PUBLIC_TEMPLATE_DIR = path.resolve(__dirname, '../../../templates/public');

/**
 * The authored service-account chain: target root (standalone projects own their
 * copy) → the brand's .omega/secrets/ (the key's ONE home in a brand
 * monorepo — the firebase manage service mints it there). Google shows SA
 * keys once, so nothing else ever holds one.
 * @param {string} projectDir - The target root.
 * @returns {string|null} First existing key path, or null.
 */
function resolveServiceAccountPath(projectDir) {
  const brandRoot = findBrandRoot(projectDir);
  return [
    path.join(projectDir, 'service-account.json'),
    brandRoot ? path.join(brandRoot, '.omega', 'secrets', 'service-account.json') : null,
  ].filter(Boolean).find((candidate) => jetpack.exists(candidate)) || null;
}

/**
 * Stage the authored target tree into dist/.
 * @param {object} options
 * @param {string} options.projectDir - The target root (firebaseProjectPath).
 * @param {string} [options.environment] - The environment the artifact is FOR:
 *   which `.env.<environment>` overlay composes into dist/.env (#586). Each lane
 *   pins its own — a deploy 'production', a test lane 'testing', the local lanes
 *   (emulator, serve, mcp) 'development'; omitted (a bare `omega build`)
 *   defaults to the running environment.
 * @param {'licensed'|'keyless'} [options.licenseStatus] - The deploy-time license
 *   verdict ([#320](https://github.com/Omega-JS-Stack/omega/issues/320)), written
 *   into dist/.env as OMEGA_LICENSE_STATUS. DEPLOY ONLY: every local lane omits
 *   it, and an artifact with no status behaves exactly as it does today.
 * @param {function} [options.log] - Line logger (silent by default).
 * @returns {{ distDir: string, staged: string[] }} staged = relative paths written.
 */
function stageFunctions(options) {
  const projectDir = options.projectDir;
  const log = options.log || (() => {});
  const srcDir = path.join(projectDir, 'src');
  const distDir = path.join(projectDir, 'dist');
  const staged = [];

  const targetPackage = jetpack.read(path.join(projectDir, 'package.json'), 'json');
  if (!targetPackage) {
    throw new Error(`No package.json at ${projectDir} — a backend target's manifest lives at the TARGET ROOT (src/dist pillar); run an OMEGA verb from a backend target root first`);
  }
  if (!jetpack.exists(srcDir)) {
    throw new Error(`No src/ under ${projectDir} — backend targets are src-first: authored code lives in src/ and dist/ is staged output (any verb scaffolds one, or move your functions code into src/)`);
  }

  // The FRAMEWORK package is not a target: its own root carries a package.json
  // beside a src/ dir, so it passes both checks above. A stray `npx omega
  // <verb>` inside it (no target context, so the dispatcher runs the host CLI)
  // otherwise wiped the framework's own dist/ — prepare-package's output, the
  // CLI it is running from — and then died on the missing omega.json5, leaving
  // the CLI unbootable ([#308](https://github.com/Omega-JS-Stack/omega/issues/308)).
  // Refuse BEFORE the wipe: there is no target here to stage.
  if (targetPackage.name === frameworkPackage.name) {
    throw new Error(`Refusing to stage ${projectDir}: that is the ${frameworkPackage.name} framework package itself, not a backend target. Its dist/ is build output of \`npm run prepare\`, never a stage target. Run omega commands from a backend TARGET root (the directory with src/ and config/omega.json5).`);
  }

  // ─── Wipe previous stage (preserve runtime artifacts) ─────────────────────
  for (const entry of jetpack.list(distDir) || []) {
    if (PRESERVE.some((pattern) => pattern.test(entry))) continue;
    jetpack.remove(path.join(distDir, entry));
  }

  // ─── Composed config (ONE compose feeds both the staged file and the
  //     public boilerplate's brand url). A stale stage can never feed back
  //     in: composeTargetConfig reads only the AUTHORED layers — dist/config
  //     is not a config location (@omega.js/config CONFIG_LOCATIONS). ───────
  const { config } = composeTargetConfig(projectDir, 'backend');

  // ─── src/** → dist/** (excluding src/public — handled separately) ─────────
  jetpack.copy(srcDir, distDir, {
    overwrite: true,
    matching: ['**/*', '!public', '!public/**'],
  });
  staged.push('src/** → dist/**');

  // ─── public/ — consumer src/public/* overrides win, defaults fill gaps ────
  const powertools = require('node-powertools');
  const publicDir = path.join(distDir, 'public');
  jetpack.dir(publicDir);
  for (const file of jetpack.list(PUBLIC_TEMPLATE_DIR) || []) {
    const consumerOverride = path.join(srcDir, 'public', file);
    const dest = path.join(publicDir, file);
    if (jetpack.exists(consumerOverride)) {
      jetpack.copy(consumerOverride, dest, { overwrite: true });
    } else {
      const template = jetpack.read(path.join(PUBLIC_TEMPLATE_DIR, file));
      jetpack.write(dest, powertools.template(template, { url: config.brand?.url || '' }));
    }
  }
  staged.push('public/ (defaults + consumer overrides)');

  // ─── Derived manifest (name/engines/runtime deps only) ────────────────────
  const dependencies = {};
  for (const [dep, spec] of Object.entries(targetPackage.dependencies || {})) {
    dependencies[dep] = /^file:(?!\/)/.test(spec) ? `file:../${spec.slice('file:'.length)}` : spec;
  }

  const name = String(targetPackage.name || path.basename(projectDir));
  const manifest = {
    name: name.endsWith('-functions') ? name : `${name}-functions`,
    version: targetPackage.version || '0.0.1',
    description: `Staged Cloud Functions for ${name} — GENERATED by omega build, do not edit`,
    private: true,
    main: 'index.js',
    engines: targetPackage.engines || { node: String(parseInt(frameworkPackage.omega.functionsRuntime, 10)) },
    dependencies,
  };
  jetpack.write(path.join(distDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  staged.push('package.json (derived)');

  // ─── Composed config → the runtime's own view ────────────────────────────
  jetpack.write(
    path.join(distDir, 'config', 'omega.json5'),
    `${CONFIG_BANNER}${JSON.stringify(config, null, 2)}\n`,
  );
  staged.push('config/omega.json5 (composed)');

  // ─── Composed .env — the artifact's own env (#678) ───────────────────────
  //     The brand root's .env is the ONE file humans and the manager edit;
  //     the target's own .env is an optional per-key override. Every verb
  //     that stages composes this file, so a brand-root key reaches the
  //     upload without anyone remembering to run a manage first.
  const composed = composeTargetEnv({ targetDir: projectDir, target: 'backend', environment: options.environment });
  //     The composer resolves every key the target CLAIMS, because the secrets
  //     publisher needs the `ci` values too; the artifact's own .env is the
  //     narrower half ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
  //     artifactEnvValues drops the runner-only keys, so the license key the
  //     deploy checks with rides the deploy PROCESS and never the upload.
  composed.values = artifactEnvValues('backend', composed.values);
  //     The one COMPUTED key in the file (#320): the deploy's license verdict,
  //     which no cascade layer can supply and no human writes. Deploy-only, so
  //     a local stage composes byte-identically to before.
  if (options.licenseStatus) composed.values.OMEGA_LICENSE_STATUS = options.licenseStatus;
  jetpack.write(path.join(distDir, '.env'), serializeEnv(composed.values));

  // Key NAMES and the layer each came from — never a value (the .env is all
  // secrets)
  const delivered = Object.keys(composed.values).map((key) => `${key} (${composed.sources[key]})`);
  staged.push(`.env (composed from the cascade${options.environment ? ` for ${options.environment}` : ''})`);
  log(`Composed dist/.env — ${delivered.length} keys: ${delivered.join(', ') || 'none'}`);

  // ─── Target-root files that ride the artifact ────────────────────────────────
  const nvmrc = path.join(projectDir, '.nvmrc');
  if (jetpack.exists(nvmrc)) {
    jetpack.copy(nvmrc, path.join(distDir, '.nvmrc'), { overwrite: true });
    staged.push('.nvmrc');
  }

  // ─── Firestore rules: the brand's source + the framework half, compiled ───
  //     Rebuilt HERE (not just at setup) because the wipe above takes the
  //     previous artifact with it, and firebase.json points the emulator and
  //     `firebase deploy` at it — a stage that skipped this would leave both
  //     reading nothing. The AUTHORED file is never touched; setup owns that.
  //     An unmigrated (marker-block) source is refused there and reported —
  //     the step is then not claimed here either.
  //     A custom-server target has neither reader, and setup seeds it no rules
  //     source (#614) — compiling one would only write an artifact nothing
  //     deploys, under a warning telling it to run a setup that will not.
  if (!isCustomProject(projectDir) && !compileFirestoreRules({ projectDir }).refused) {
    staged.push(`${COMPILED_RULES_FILE.replace('dist/', '')} (compiled)`);
  }

  // ─── Service account: the authored chain (see resolveServiceAccountPath) ──
  const saSource = resolveServiceAccountPath(projectDir);
  if (saSource) {
    jetpack.copy(saSource, path.join(distDir, 'service-account.json'), { overwrite: true });
    staged.push('service-account.json');
  }

  log(`Staged dist/ from src/ (${staged.length} steps)`);
  return { distDir, staged };
}

/**
 * The .env layers ABOVE the target that feed the composed dist/.env — the
 * brand root's and the company root's, resolved through the chain
 * (@omega.js/config resolveEnvChain), never a hard-coded `../../.env`. The
 * target's own .env is watched by name with the other target-root inputs.
 *
 * A standalone target has neither, so the list is empty
 * ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)).
 *
 * @param {string} projectDir - The target root.
 * @returns {Array<{ layer: string, path: string }>} Absolute .env paths.
 */
function envWatchInputs(projectDir) {
  const chain = resolveEnvChain(projectDir);

  return [
    { layer: 'brand', path: chain.brand },
    { layer: 'company', path: chain.company },
  ].filter((input) => input.path);
}

/**
 * Watch every STAGE INPUT and re-stage on change — src/, the target manifest,
 * .env/.nvmrc/SA, the brand-root and company .env (the composed dist/.env's
 * upper layers), firestore.rules, and the config layers (target + brand
 * omega.json5, brand secrets). The Firebase emulator watches dist/ natively,
 * so a re-stage IS the hot reload: a brand-config edit reaches the running
 * emulator without a restart, and so does a brand rules edit (the re-stage
 * recompiles dist/firestore.rules, which the firestore emulator reloads). The target-root watch filters to named files so dist/ churn (our
 * own output) can never feed back into a re-stage loop.
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} [options.environment] - The environment every re-stage
 *   composes dist/.env for (#586) — the boot's own, so a hot reload never
 *   swaps the artifact's overlay under a running lane.
 * @param {function} [options.log]
 * @param {number} [options.debounceMs]
 * @returns {{ close: function }}
 */
function watchAndStage(options) {
  const fs = require('fs');
  const projectDir = options.projectDir;
  const log = options.log || (() => {});
  const debounceMs = options.debounceMs || 250;
  const watchers = [];
  let timer = null;

  const restage = (reason) => () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        stageFunctions({ projectDir, environment: options.environment });
        log(`Re-staged dist/ (${reason} changed)`);
      } catch (error) {
        log(`Re-stage failed: ${error.message}`);
      }
    }, debounceMs);
  };

  const watch = (dir, onChange, opts) => {
    if (!jetpack.exists(dir)) return;
    watchers.push(fs.watch(dir, opts || {}, onChange));
  };

  watch(path.join(projectDir, 'src'), restage('src'), { recursive: true });

  // Target-root stage inputs by NAME (never react to dist/ or log churn). The
  // `.env.<environment>` overlays are inputs too (#586), all three, because the
  // target root is watched once for every lane and a re-stage is idempotent.
  // The layer NAMES come from @omega.js/config's envLayerFiles, the one home of
  // the `.env` + overlay spelling ([#681](https://github.com/Omega-JS-Stack/omega/issues/681)).
  const TARGET_ROOT_INPUTS = new Set([
    'package.json', '.nvmrc', 'service-account.json', BRAND_RULES_FILE,
    ...ENV_ENVIRONMENTS.flatMap((environment) => envLayerFiles('.env', environment)),
  ]);
  watch(projectDir, (event, filename) => {
    if (TARGET_ROOT_INPUTS.has(filename)) restage(filename)();
  });

  // The composed .env's upper layers: a brand-root edit restages exactly like a
  // target .env edit, so a running dev server picks the new key up (#678). The
  // lane's OWN overlay counts as that layer's .env (#586); another
  // environment's file is not in this artifact and must not re-stage it. That
  // pair IS what envLayerFiles answers, so it is asked rather than spelled out
  // ([#681](https://github.com/Omega-JS-Stack/omega/issues/681)).
  const laneNames = new Set(envLayerFiles('.env', options.environment));
  for (const input of envWatchInputs(projectDir)) {
    watch(path.dirname(input.path), (event, filename) => {
      if (laneNames.has(filename)) restage(`${input.layer} ${filename}`)();
    });
  }

  // Config layers: the target's own config/ and the brand's config/ + secrets
  const brandRoot = findBrandRoot(projectDir);
  watch(path.join(projectDir, 'config'), restage('local config'));
  if (brandRoot) {
    watch(path.join(brandRoot, 'config'), restage('brand config'));
    watch(path.join(brandRoot, '.omega', 'secrets'), restage('brand secrets'));
  }

  return {
    close: () => {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}

module.exports = { stageFunctions, watchAndStage, envWatchInputs, resolveServiceAccountPath, PRESERVE };

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
 *   .env                  → dist/.env               (verbatim copy — disperse
 *                           composes brand-level values into the LOCAL .env now;
 *                           a DEPLOY stage drops the schema's `_DEV` rows, #586)
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
 * root's install (plain Node resolution); deploys keep cp100d's
 * stage-local-packages (packed file: deps + lockfile) on top of this stage.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const { composeTargetConfig, findBrandRoot, devEnvKeys } = require('@omega.js/config');
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
 * Drop the env schema's dev-only rows from .env content (#586). The `_DEV`
 * payment secrets exist so a LOCAL run never touches a live payment account;
 * uploading them would put a test credential inside the deployed runtime's
 * env, one stale `ENVIRONMENT` away from serving real customers with it. The
 * key list is the schema's (`devEnvKeys()`), never a copy.
 *
 * Assignments only: a `# KEY=` placeholder carries no value and stays, so the
 * artifact's .env keeps the shape `omega setup` templated.
 *
 * @param {string} content - The authored .env content.
 * @returns {string} The same content minus every dev-only assignment.
 */
function stripDevEnvRows(content) {
  const dev = new Set(devEnvKeys());

  return content
    .split('\n')
    .filter((line) => {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return !match || !dev.has(match[1]);
    })
    .join('\n');
}

/**
 * Stage the authored target tree into dist/.
 * @param {object} options
 * @param {string} options.projectDir - The target root (firebaseProjectPath).
 * @param {boolean} [options.deploy] - Stage for an UPLOAD: the .env loses its
 *   dev-only rows (see stripDevEnvRows). Local lanes re-stage without it.
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
    throw new Error(`No package.json at ${projectDir} — a backend target's manifest lives at the TARGET ROOT (src/dist pillar); run npx omega setup first`);
  }
  if (!jetpack.exists(srcDir)) {
    throw new Error(`No src/ under ${projectDir} — backend targets are src-first: authored code lives in src/ and dist/ is staged output (run npx omega setup to scaffold, or move your functions code into src/)`);
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

  // ─── Target-root files that ride the artifact ────────────────────────────────
  for (const file of ['.env', '.nvmrc']) {
    const source = path.join(projectDir, file);
    if (!jetpack.exists(source)) continue;

    if (file === '.env' && options.deploy) {
      jetpack.write(path.join(distDir, file), stripDevEnvRows(jetpack.read(source)));
      staged.push('.env (dev-only keys stripped for the upload)');
      continue;
    }

    jetpack.copy(source, path.join(distDir, file), { overwrite: true });
    staged.push(file);
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
 * Watch every STAGE INPUT and re-stage on change — src/, the target manifest,
 * .env/.nvmrc/SA, firestore.rules, and the config layers (target + brand
 * omega.json5, brand secrets). The Firebase emulator watches dist/ natively,
 * so a re-stage IS the hot reload: a brand-config edit reaches the running
 * emulator without a restart, and so does a brand rules edit (the re-stage
 * recompiles dist/firestore.rules, which the firestore emulator reloads). The target-root watch filters to named files so dist/ churn (our
 * own output) can never feed back into a re-stage loop.
 * @param {object} options
 * @param {string} options.projectDir
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
        stageFunctions({ projectDir });
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

  // Target-root stage inputs by NAME (never react to dist/ or log churn)
  const TARGET_ROOT_INPUTS = new Set(['package.json', '.env', '.nvmrc', 'service-account.json', BRAND_RULES_FILE]);
  watch(projectDir, (event, filename) => {
    if (TARGET_ROOT_INPUTS.has(filename)) restage(filename)();
  });

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

module.exports = { stageFunctions, watchAndStage, resolveServiceAccountPath, PRESERVE };

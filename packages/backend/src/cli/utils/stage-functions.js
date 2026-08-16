/**
 * stage-functions — the backend consumer build step (src/dist pillar).
 *
 * `dist/` is GENERATED OUTPUT, staged fresh from the authored app tree:
 *
 *   src/**                → dist/**                 (1:1 copy, no transforms)
 *   package.json          → dist/package.json       (derived: name/engines/deps)
 *   config layers         → dist/config/omega.json5 (composeTargetConfig —
 *                           brand⊕app flattened; the deployed runtime cannot
 *                           walk up past the upload boundary, cp100e)
 *   .env                  → dist/.env               (verbatim copy — disperse
 *                           composes brand-level values into the APP .env now)
 *   .nvmrc                → dist/.nvmrc
 *   service-account.json  → dist/service-account.json (app root, else the
 *                           brand's .omega/secrets/ — the key's ONE home)
 *   src/public/** OR      → dist/public/**          (consumer overrides win;
 *   templates/public/**                               defaults fill the gaps)
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
 * node_modules is NOT staged: local runs resolve up from dist/ to the app
 * root's install (plain Node resolution); deploys keep cp100d's
 * stage-local-packages (packed file: deps + lockfile) on top of this stage.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const { composeTargetConfig, findBrandRoot } = require('@omega.js/config');

// The framework's pinned Cloud Functions runtime — the engines fallback when
// an app manifest carries none (never the ambient node: staging must produce
// the same artifact under any shell)
const frameworkPackage = require('../../../package.json');

// dist/ entries that survive a re-stage (runtime artifacts, never authored)
const PRESERVE = [/^node_modules$/, /\.log$/];

const CONFIG_BANNER = '// Staged by `omega build` (brand+app config layers flattened for the runtime\n'
  + '// and the deploy upload boundary). GENERATED — edit the brand/app omega.json5.\n';

const PUBLIC_TEMPLATE_DIR = path.resolve(__dirname, '../../../templates/public');

/**
 * The authored service-account chain: app root (standalone apps own their
 * copy) → the brand's .omega/secrets/ (the key's ONE home in a brand
 * monorepo — the firebase manage service mints it there). Google shows SA
 * keys once, so nothing else ever holds one.
 * @param {string} projectDir - The app root.
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
 * Stage the authored app tree into dist/.
 * @param {object} options
 * @param {string} options.projectDir - The app root (firebaseProjectPath).
 * @param {function} [options.log] - Line logger (silent by default).
 * @returns {{ distDir: string, staged: string[] }} staged = relative paths written.
 */
function stageFunctions(options) {
  const projectDir = options.projectDir;
  const log = options.log || (() => {});
  const srcDir = path.join(projectDir, 'src');
  const distDir = path.join(projectDir, 'dist');
  const staged = [];

  const appPackage = jetpack.read(path.join(projectDir, 'package.json'), 'json');
  if (!appPackage) {
    throw new Error(`No package.json at ${projectDir} — a backend app's manifest lives at the APP ROOT (src/dist pillar); run npx omega setup first`);
  }
  if (!jetpack.exists(srcDir)) {
    throw new Error(`No src/ under ${projectDir} — backend apps are src-first: authored code lives in src/ and dist/ is staged output (run npx omega setup to scaffold, or move your functions code into src/)`);
  }

  // The FRAMEWORK package is not an app: its own root carries a package.json
  // beside a src/ dir, so it passes both checks above. A stray `npx omega
  // <verb>` inside it (no app context, so the dispatcher runs the host CLI)
  // otherwise wiped the framework's own dist/ — prepare-package's output, the
  // CLI it is running from — and then died on the missing omega.json5, leaving
  // the CLI unbootable ([#308](https://github.com/Omega-JS-Stack/omega/issues/308)).
  // Refuse BEFORE the wipe: there is no app here to stage.
  if (appPackage.name === frameworkPackage.name) {
    throw new Error(`Refusing to stage ${projectDir}: that is the ${frameworkPackage.name} framework package itself, not a backend app. Its dist/ is build output of \`npm run prepare\`, never a stage target. Run omega commands from a backend APP root (the directory with src/ and config/omega.json5).`);
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
  for (const [dep, spec] of Object.entries(appPackage.dependencies || {})) {
    dependencies[dep] = /^file:(?!\/)/.test(spec) ? `file:../${spec.slice('file:'.length)}` : spec;
  }

  const name = String(appPackage.name || path.basename(projectDir));
  const manifest = {
    name: name.endsWith('-functions') ? name : `${name}-functions`,
    version: appPackage.version || '0.0.1',
    description: `Staged Cloud Functions for ${name} — GENERATED by omega build, do not edit`,
    private: true,
    main: 'index.js',
    engines: appPackage.engines || { node: String(parseInt(frameworkPackage.omega.functionsRuntime, 10)) },
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

  // ─── App-root files that ride the artifact ────────────────────────────────
  for (const file of ['.env', '.nvmrc']) {
    const source = path.join(projectDir, file);
    if (!jetpack.exists(source)) continue;
    jetpack.copy(source, path.join(distDir, file), { overwrite: true });
    staged.push(file);
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
 * Watch every STAGE INPUT and re-stage on change — src/, the app manifest,
 * .env/.nvmrc/SA, and the config layers (app + brand omega.json5, brand
 * secrets). The Firebase emulator watches dist/ natively, so a re-stage IS
 * the hot reload: a brand-config edit reaches the running emulator without
 * a restart. The app-root watch filters to named files so dist/ churn (our
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

  // App-root stage inputs by NAME (never react to dist/ or log churn)
  const APP_ROOT_INPUTS = new Set(['package.json', '.env', '.nvmrc', 'service-account.json']);
  watch(projectDir, (event, filename) => {
    if (APP_ROOT_INPUTS.has(filename)) restage(filename)();
  });

  // Config layers: the app's own config/ and the brand's config/ + secrets
  const brandRoot = findBrandRoot(projectDir);
  watch(path.join(projectDir, 'config'), restage('app config'));
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

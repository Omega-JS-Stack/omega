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

// dist/ entries that survive a re-stage (runtime artifacts, never authored)
const PRESERVE = [/^node_modules$/, /\.log$/];

const CONFIG_BANNER = '// Staged by `omega build` (brand+app config layers flattened for the runtime\n'
  + '// and the deploy upload boundary). GENERATED — edit the brand/app omega.json5.\n';

const PUBLIC_TEMPLATE_DIR = path.resolve(__dirname, '../../../templates/public');

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

  // ─── Wipe previous stage (preserve runtime artifacts) ─────────────────────
  for (const entry of jetpack.list(distDir) || []) {
    if (PRESERVE.some((pattern) => pattern.test(entry))) continue;
    jetpack.remove(path.join(distDir, entry));
  }

  // ─── src/** → dist/** (excluding src/public — handled separately) ─────────
  jetpack.copy(srcDir, distDir, {
    overwrite: true,
    matching: ['**/*', '!public', '!public/**'],
  });
  staged.push('src/** → dist/**');

  // ─── public/ — consumer src/public/* overrides win, defaults fill gaps ────
  const publicDir = path.join(distDir, 'public');
  jetpack.dir(publicDir);
  let url = '';
  try {
    const config = composeTargetConfig(projectDir, 'backend').config;
    url = config.brand?.url || '';
  } catch (e) { /* compose failed — use empty url */ }
  const powertools = require('node-powertools');
  for (const file of jetpack.list(PUBLIC_TEMPLATE_DIR) || []) {
    const consumerOverride = path.join(srcDir, 'public', file);
    const dest = path.join(publicDir, file);
    if (jetpack.exists(consumerOverride)) {
      jetpack.copy(consumerOverride, dest, { overwrite: true });
    } else {
      const template = jetpack.read(path.join(PUBLIC_TEMPLATE_DIR, file));
      jetpack.write(dest, powertools.template(template, { url: url || '' }));
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
    engines: appPackage.engines || { node: String(parseInt(process.versions.node, 10)) },
    dependencies,
  };
  jetpack.write(path.join(distDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  staged.push('package.json (derived)');

  // ─── Composed config ─────────────────────────────────────────────────────
  const { config } = composeTargetConfig(projectDir, 'backend');
  jetpack.write(
    path.join(distDir, 'config', 'omega.json5'),
    CONFIG_BANNER + JSON.stringify(config, null, 2) + '\n',
  );
  staged.push('config/omega.json5 (composed)');

  // ─── App-root files that ride the artifact ────────────────────────────────
  for (const file of ['.env', '.nvmrc']) {
    const source = path.join(projectDir, file);
    if (!jetpack.exists(source)) continue;
    jetpack.copy(source, path.join(distDir, file), { overwrite: true });
    staged.push(file);
  }

  // ─── Service account: app root (standalone) → brand secrets home ──────────
  // Google shows SA keys once — the brand's gitignored .omega/secrets/ is the
  // ONE home (the firebase manage service mints it there); a standalone app
  // keeps its own copy at the app root.
  const brandRoot = findBrandRoot(projectDir);
  const saSource = [
    path.join(projectDir, 'service-account.json'),
    brandRoot ? path.join(brandRoot, '.omega', 'secrets', 'service-account.json') : null,
  ].filter(Boolean).find((candidate) => jetpack.exists(candidate));
  if (saSource) {
    jetpack.copy(saSource, path.join(distDir, 'service-account.json'), { overwrite: true });
    staged.push('service-account.json');
  }

  log(`Staged dist/ from src/ (${staged.length} steps)`);
  return { distDir, staged };
}

/**
 * Watch src/ and re-stage on change. The Firebase emulator watches the dist
 * dir natively, so a re-stage IS the hot reload.
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

  const restage = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        stageFunctions({ projectDir });
        log('Re-staged dist/ (src changed)');
      } catch (error) {
        log(`Re-stage failed: ${error.message}`);
      }
    }, debounceMs);
  };

  const srcDir = path.join(projectDir, 'src');
  if (jetpack.exists(srcDir)) {
    watchers.push(fs.watch(srcDir, { recursive: true }, restage));
  }

  return {
    close: () => {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}

module.exports = { stageFunctions, watchAndStage, PRESERVE };

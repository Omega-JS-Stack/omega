/**
 * ensure-target — the LOCAL, idempotent scaffold every verb runs
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * `omega setup` used to own this half and nothing ran it for you, so a target
 * drifted until someone remembered the command per target. It is retired: the
 * "write it if missing" steps live here and build/package/publish/test/deploy
 * all call it first, so every verb heals the tree on the way past.
 *
 * What it guarantees, in this order:
 *
 *   package.json      the omega verb scripts, `private`, and the electron main
 *                     entry — pure manifest edits, so they land before anything
 *                     that can throw
 *   .nvmrc            SEEDED from the framework's pinned Electron runtime when
 *                     the file is missing; the postinstall sync-nvmrc script is
 *                     the one live reader of the Electron releases feed and
 *                     keeps it current from there (one writer per fact)
 *   node version      a WARNING when the running major is not the pin
 *   peer dependencies installed when missing or behind (a satisfied target
 *                     installs nothing)
 *   defaults tree     src/defaults/** — copy-if-missing, marker merges for
 *                     .env/.gitignore/AGENTS.md, workflows re-rendered
 *   locality          a WARNING when the framework is a `file:` link
 *
 * Everything here is copy-if-missing, marker-merge or write-if-changed. What
 * needs the network is NOT here — cert validation, repo provisioning, secret
 * publication and the framework freshness check are `omega deploy` prechecks
 * (deploy-precheck.js).
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const version = require('wonderful-version');
const Manager = new (require('../../build.js'));
const { ensurePeerDependencies, readProject } = require('./dependencies.js');
const { renderSecretsBlock } = require('@omega.js/config/env-delivery');
const { composeTargetWorkflows } = require('@omega.js/devkit/ci-workflows');
const { assertScaffoldable } = require('@omega.js/devkit/scaffold-guard');

const logger = Manager.logger('ensure-target');
const package = Manager.getPackage('main');

/**
 * Sync the consumer manifest: the omega verb scripts, the npm-private latch,
 * and the electron main entry (the gulp webpack task's output bundle).
 * Identical content is not a write (#590).
 */
function setupScripts(projectDir, result) {
  projectDir = projectDir || Manager.getRootPath('project');
  result = result || { changed: [] };

  const project = readProject(projectDir);

  project.scripts = project.scripts || {};

  Object.keys(package.projectScripts || {}).forEach((key) => {
    project.scripts[key] = package.projectScripts[key];
  });

  // Electron consumer projects should not be published to npm
  project.private = true;

  // Point electron at the built main bundle.
  // The gulp `webpack` task emits dist/main.bundle.js; the consumer's src/main.js is the *source* entry.
  project.main = 'dist/main.bundle.js';

  // Save the project — npm's own shape, trailing newline included. `jetpack.write`
  // emits none, and this used to write unconditionally, so every build re-stripped
  // the newline a consumer's editor or lint hook put back.
  const projectPath = path.join(projectDir, 'package.json');
  const contents = `${JSON.stringify(project, null, 2)}\n`;

  if (jetpack.read(projectPath) === contents) {
    return;
  }

  jetpack.write(projectPath, contents);
  result.changed.push('package.json (scripts + main + private)');
}

/**
 * Seed .nvmrc from the framework's pinned Electron runtime when it is missing.
 * An existing pin is left alone: `scripts/sync-nvmrc.js` (the consumer's
 * postinstall) is the ONE reader of the Electron releases feed and owns keeping
 * it current, so this offline seed can never fight it.
 */
function ensureNvmrc(projectDir, requiredMajor, result) {
  const nvmrcPath = path.join(projectDir, '.nvmrc');

  if (jetpack.exists(nvmrcPath)) {
    return;
  }

  jetpack.write(nvmrcPath, `v${requiredMajor}/*\n`);
  result.written.push('.nvmrc');
}

/**
 * Warn when the running Node major is not the target's pin. Never fatal (#15):
 * the pin is written, the remaining steps complete, and manage runs spawn
 * verbs under the app's own Node anyway.
 */
function checkNodeVersion(projectDir, requiredMajor, warn) {
  const installedMajor = version.clean(process.version).split('.')[0];

  if (String(installedMajor) === String(requiredMajor)) {
    return;
  }

  warn(
    `Node version mismatch: running v${installedMajor} but Electron requires v${requiredMajor} (matches Electron's bundled Node). `
    + `Standalone shells: run \`nvm use\` (the .nvmrc is pinned to v${requiredMajor}/*) before the next build.`,
  );
}

/**
 * Apply the framework's defaults tree (src/defaults/**) to the target root via
 * the shared devkit engine.
 *
 * @param {string} projectDir - The target root.
 * @param {object} log - `{ log, warn, error }` handed to the engine.
 */
async function copyDefaults(projectDir, engineLogger) {
  projectDir = projectDir || Manager.getRootPath('project');
  engineLogger = engineLogger || logger;

  const defaultsDir = path.resolve(__dirname, '..', '..', 'defaults');

  if (!jetpack.exists(defaultsDir)) {
    engineLogger.warn(`Defaults directory not found at ${defaultsDir}`);
    return;
  }

  // Template substitution context — `{{ versions.node }}` etc. resolved at scaffold time.
  // Source of truth is @omega.js/desktop's pinned `omega.nodeRuntime` (the Electron-bundled
  // Node major; consumers' .nvmrc additionally self-syncs from the live Electron feed via
  // scripts/sync-nvmrc.js). `engines.node` is deliberately NOT used here — it's the honest
  // dev floor (`>=22`), not a renderable version.
  // `githubSecrets` is the build workflow's env block, GENERATED from the env
  // schema ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)): one
  // `KEY: ${{ secrets.KEY }}` line per key the schema delivers to desktop, at
  // the token's two-space indent. The yml rule below re-renders on every verb,
  // so the block tracks the schema like the node version tracks the pin.
  const templateContext = {
    versions: { ...(package.engines || {}), node: package.omega.nodeRuntime },
    githubSecrets: renderSecretsBlock('desktop', { indent: '  ' }),
  };

  // Scaffolding runs through the shared devkit engine (vendored at prepare time).
  // Engine built-ins cover @omega.js/desktop's structural rules: `_.` renames (`_.gitignore` → `.gitignore`),
  // archive-dir skips (`_mas/` reference plists ship in the package, never to
  // consumers — `_`-prefixed FILENAMES like `test/_init.js` still copy), and
  // write-only-if-changed.
  const { applyDefaults, renderTemplate } = require('@omega.js/devkit/defaults-engine');

  // Layer-aware config (cp121c/cp122d): brand targets carry NO local-layer
  // omega.json5 — the brand file's `targets.*` is the per-target home, and
  // the local file is the STANDALONE escape hatch only. Inside a brand
  // monorepo the template's config must not scaffold at all (the old
  // targets-only seed kept resurrecting deleted local files on every run).
  const { resolveSeedMode } = require('@omega.js/config');
  const seed = resolveSeedMode(projectDir);
  const isBrandTarget = !seed.standalone;

  const applied = applyDefaults({
    defaultsDir,
    outputDir: projectDir,
    fileMap: {
      // Consumers own their files — never overwrite what exists.
      '**/*': { overwrite: false },
      ...(isBrandTarget ? { 'config/omega.json5': { skip: true } } : {}),
      // Marker-section merges: framework owns the Default section, consumer owns
      // everything below the Custom marker. Every verb keeps the framework
      // section live-synced without clobbering the consumer's values.
      // The target-root .env is NOT scaffolded ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)):
      // the brand root's .env is the one file humans and the manager edit, a
      // target .env is an optional per-key override a HUMAN writes, and no
      // machine writes a target .env — so the template is gone.
      '_.gitignore': { mergeLines: true, template: templateContext },
      // The agent-docs chain (#63): AGENTS.md carries the content (marker-merged
      // like .gitignore), CLAUDE.md is the one-line `@AGENTS.md` pointer — copied
      // when missing by the `**/*` rule above, never clobbered.
      'AGENTS.md': { mergeLines: true, template: templateContext },
      // Brand doc unification (Ian 2026-07-20): inside a brand monorepo the
      // BRAND ROOT is the one doc home — per-target AGENTS.md/CLAUDE.md/CHANGELOG.md/docs/
      // never scaffold, and existing framework-owned-only copies are swept
      // (retire rules; consumer content is never destroyed). Standalone projects
      // keep them. Last-match-wins: these override the rules above.
      ...(isBrandTarget ? {
        'AGENTS.md': { retire: true, template: templateContext },
        'CLAUDE.md': { retire: true, template: templateContext },
        'CHANGELOG.md': { retire: true },
        'docs/**/*': { retire: true },
      } : {}),
      // Workflow YAMLs are framework-owned: always re-rendered so they track changes in
      // @omega.js/desktop's defaults (e.g. engines.node bumping when Electron updates). The
      // renderer is tolerant — GitHub Actions' `${{ secrets.X }}` survives — and
      // the engine skips the write when the rendered content is byte-identical.
      '**/*.{yml,yaml}': { overwrite: true, template: templateContext },
      // CI (#265): GitHub runs workflows from the REPO ROOT only, so a per-target
      // .github/workflows/ in a brand monorepo can never fire — the #627 secrets
      // block was rendering into a file Actions would never execute. It is
      // composed into the brand root below instead, scoped to this target's
      // path, exactly as web and the extension do. Last-match-wins over the yml
      // rule above; a STANDALONE target (its own git root) keeps its own copy.
      ...(isBrandTarget ? { '.github/**/*': { skip: true } } : {}),
    },
    logger: engineLogger,
  });

  if (isBrandTarget) {
    // The same templateContext the yml rule uses, so the composed copy carries
    // the generated `githubSecrets` block — a composed workflow with the raw
    // token in it would be the only file CI actually runs, and broken.
    composeTargetWorkflows({
      sourceDir: path.join(defaultsDir, '.github', 'workflows'),
      targetDir: projectDir,
      brandRoot: seed.brandRoot,
      transform: (contents) => renderTemplate(contents, templateContext),
      logger: engineLogger,
    });
  }

  return applied;
}

/** Warn when the framework is a `file:` link — that install never publishes. */
function checkLocality(projectDir, warn) {
  const project = readProject(projectDir);
  const installedVersion = project.devDependencies[package.name] || project.dependencies[package.name];

  if (!installedVersion) {
    throw new Error(`No installed version of ${package.name} found in dependencies or devDependencies.`);
  }

  if (installedVersion.startsWith('file:')) {
    warn(`⚠️  You are using the local version of ${package.name}. This WILL NOT WORK when published.`);
  }
}

/**
 * Make the target whole — idempotent, offline, and quiet when there is
 * nothing to do.
 *
 * @param {object} [options]
 * @param {string} [options.projectDir] - The target root (default: cwd).
 * @param {function} [options.log] - Line logger (silent by default).
 * @param {function} [options.warn] - Warning logger (silent by default).
 * @returns {Promise<{ written: string[], merged: string[], changed: string[] }>}
 *   Target-relative paths per outcome — empty on a no-op run.
 */
async function ensureTarget(options) {
  options = options || {};
  const projectDir = options.projectDir || Manager.getRootPath('project');
  const log = options.log || (() => {});
  const warn = options.warn || (() => {});
  const result = { written: [], merged: [], changed: [] };

  // The framework's own tree is not a consumer target. Running the framework's
  // suite from packages/desktop puts the framework at the cwd, and a verb that
  // scaffolds unconditionally would install its own peer deps into itself and
  // scatter the consumer defaults through the package. Refuse, quietly: this is
  // a normal state, not a broken one.
  if (readProject(projectDir).name === package.name) {
    return result;
  }

  // A workspace ROOT is not a target either — and unlike the case above, landing
  // there is an accident (a verb run from the wrong cwd), so it fails LOUD (#699).
  assertScaffoldable(projectDir);

  // The Electron-bundled Node major, offline: the framework's pinned runtime.
  // `engines.node` is the honest dev FLOOR (`>=22`), never a version.
  const requiredMajor = version.clean(package.omega.nodeRuntime).split('.')[0];

  // Manifest edits FIRST — they don't depend on the Node version or the peer
  // deps being right, and the consumer needs the postinstall script wired up
  // regardless of what the steps below find.
  setupScripts(projectDir, result);
  ensureNvmrc(projectDir, requiredMajor, result);
  checkNodeVersion(projectDir, requiredMajor, warn);

  await ensurePeerDependencies({ projectDir, package, log });

  const applied = await copyDefaults(projectDir, { log: () => {}, warn, error: warn });
  if (applied) {
    result.written.push(...applied.written);
    result.merged.push(...applied.merged);
  }

  checkLocality(projectDir, warn);

  for (const [label, files] of [['Created', result.written], ['Merged', result.merged], ['Synced', result.changed]]) {
    if (files.length > 0) log(`${label} ${files.join(', ')}`);
  }

  return result;
}

module.exports = { ensureTarget, setupScripts, copyDefaults };

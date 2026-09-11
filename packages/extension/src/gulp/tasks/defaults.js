// Libraries
const Manager = new (require('../../build.js'));
const logger = Manager.logger('defaults');
const watcherLogger = Manager.logger('defaults:watcher');
const workflowLogger = Manager.logger('defaults:workflows');
const { watch, series } = require('gulp');
const jetpack = require('fs-jetpack');
const path = require('path');
const { template } = require('node-powertools');
const { applyDefaults } = require('@omega.js/devkit/defaults-engine');
const { renderSecretsBlock } = require('@omega.js/config/env-delivery');
const { composeTargetWorkflows, renderInstallFirewall } = require('@omega.js/devkit/ci-workflows');

// Load package
const package = Manager.getPackage('main');
const config = Manager.getConfig('project');
const rootPathPackage = Manager.getRootPath('main');

// Get clean versions — the pinned consumer Node (omega.nodeRuntime), NOT
// engines.node: engines is the honest dev floor (>=22), templates need a
// concrete version to render (.nvmrc etc.)
const cleanVersions = { versions: { ...package.engines, node: package.omega.nodeRuntime } };

// File MAP — rule vocabulary is the devkit defaults engine's (minimatch patterns,
// last-match-wins). Engine built-ins cover what used to be explicit rules here:
// `_.` renames (`_.gitignore` → `.gitignore`), `.gitkeep` dir creation, `.DS_Store` skips,
// and write-only-if-changed.
const FILE_MAP = {
  // Files to skip overwrite
  '**/*.md': {
    overwrite: false,
  },
  'hooks/**/*': {
    overwrite: false,
  },
  'src/**/*': {
    overwrite: false,
  },
  // Consumer-owned after seeding (e.g. test/_init.js fixture hooks) — copy when
  // missing, never clobber the consumer's version on setup reruns (the engine
  // fall-through default is overwrite: true)
  'test/**/*': {
    overwrite: false,
  },
  'src/**/*.{html,md}': {
    skip: (file) => {
      // Get the name
      const name = path.basename(file.name, path.extname(file.name));
      const htmlFilePath = path.join(file.destination, `${name}.html`);
      const mdFilePath = path.join(file.destination, `${name}.md`);
      const htmlFileExists = jetpack.exists(htmlFilePath);
      const mdFileExists = jetpack.exists(mdFilePath);
      const eitherExists = htmlFileExists || mdFileExists;

      // Skip if both files exist
      return eitherExists;
    },
  },

  // Marker-section merges (framework owns Default, consumer owns Custom).
  // The target-root .env is NOT scaffolded ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)):
  // the brand root's .env is the one file humans and the manager edit, a target
  // .env is an optional per-key override a HUMAN writes, and no machine writes a
  // target .env — so the template is gone.
  '_.gitignore': {
    mergeLines: true,
  },

  // The agent-docs chain (#63): AGENTS.md carries the content and uses the same
  // marker-based merge as .gitignore; CLAUDE.md is the one-line `@AGENTS.md`
  // pointer, left to the `**/*.md` rule above (copied when missing, never clobbered).
  // Must come AFTER `**/*.md` (which sets overwrite: false) — last-match-wins,
  // so this rule's `mergeLines: true` activates the merge path even though the
  // catch-all would otherwise skip.
  'AGENTS.md': {
    mergeLines: true,
  },

  // Consumer-owned after first seed — the framework-resolving shim
  // (friction #14); consumers may customize their gulpfile.
  'gulpfile.js': {
    overwrite: false,
  },

  // Config files
  'config/omega.json5': {
    overwrite: true,
    merge: true,
  },
  'config/messages.json': {
    overwrite: false,
  },
  'config/description.md': {
    overwrite: false,
  },

  // Files to run templating on
  '.nvmrc': {
    template: cleanVersions,
  },

  // Files to skip
  '**/__temp/**/*': {
    skip: true,
  },
}

// Glob
const input = [
  // Files to include
  `${rootPathPackage}/dist/defaults/**/*`,
];
const delay = 250;

// Extensions the global site-token pass applies to — same list (and same
// `[ site.x ]` bracket syntax) as utils/template-transform.js, which the
// distribute task still uses as a gulp stream.
const TEMPLATE_EXTENSIONS = ['html', 'md', 'liquid', 'json', 'yml', 'yaml'];

// The Chrome Web Store caps a listing description at 200 characters.
const STORE_DESCRIPTION_CAP = 200;

// The store description config/messages.json seeds. `brand.description` is
// already the one-sentence brand line, so it seeds appDescription whenever it
// FITS the store cap — every consumer used to hand-edit this one field (#573).
// Anything longer (or absent) keeps the generic phrasing.
function resolveAppDescription() {
  const description = (config.brand?.description || '').trim();

  if (description && description.length <= STORE_DESCRIPTION_CAP) {
    return description;
  }

  return `The official ${config.brand?.name || ''} browser extension.`.replace(/\s{2,}/g, ' ');
}

// Every message the seed renders lands INSIDE a single-quoted JSON5 string, so a
// value carrying an apostrophe would otherwise leave the scaffolded file
// unparseable. All four seeded strings — the brand name three of them render, and
// the description — go through this one escape (#592).
function escapeSingleQuoted(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}

function siteTokenTransform(contents, item) {
  const ext = path.extname(item.name).toLowerCase().slice(1);
  if (!TEMPLATE_EXTENSIONS.includes(ext)) {
    return contents;
  }

  try {
    // The firewall step is devkit's, rendered wherever a workflow is WRITTEN
    // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): this pass
    // writes a STANDALONE target's own copy, and composeWorkflow renders the
    // same token on the brand-root copy. The action and its pin live in ONE
    // place, so the template restates neither.
    return renderInstallFirewall(template(contents, {
      site: config,
      versions: cleanVersions.versions,
      extension: {
        name: escapeSingleQuoted((config.brand?.name || '').trim()),
        description: escapeSingleQuoted(resolveAppDescription()),
      },
      // The publish workflow's env block is GENERATED from the env schema
      // ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)) — one
      // `KEY: ${{ secrets.KEY }}` line per key the schema delivers to the
      // extension, at the token's two-space indent. The workflow scaffolds with
      // overwrite: true, so every verb re-renders it from the current schema.
      githubSecrets: renderSecretsBlock('extension', { indent: '  ' }),
    }, {
      brackets: ['[', ']'],
    }));
  } catch (error) {
    logger.error(`Error processing templates in ${item.name}:`, error);
    return contents;
  }
}

// Core scaffold — shared devkit engine. Exported for the build-layer scaffold
// test and the setup command (friction #13: consumers scaffold at setup, and
// the build's defaults task keeps them synced).
function scaffoldDefaults(options) {
  options = options || {};
  const outputDir = options.outputDir || path.resolve('./');

  // Layer-aware config (cp121c/cp122d): brand targets carry NO local-layer
  // omega.json5 — the brand file's `targets.*` is the per-target home, and
  // that file is the STANDALONE escape hatch only. Inside a brand
  // monorepo the template's config must not scaffold at all (the old
  // targets-only seed kept resurrecting deleted local files on every setup).
  const fileMap = { ...FILE_MAP };
  const { resolveSeedMode } = require('@omega.js/config');
  const seed = resolveSeedMode(outputDir);
  if (!seed.standalone) {
    fileMap['config/omega.json5'] = { skip: true };
    // Brand doc unification (Ian 2026-07-20): inside a brand monorepo the
    // BRAND ROOT is the one doc home — per-target AGENTS.md/CLAUDE.md/CHANGELOG.md/docs/
    // never scaffold, and existing framework-owned-only copies are swept
    // (retire rules; consumer content is never destroyed). Standalone projects
    // keep them. Last-match-wins over the `**/*.md` preserve rule.
    fileMap['AGENTS.md'] = { retire: true };
    fileMap['CLAUDE.md'] = { retire: true };
    fileMap['CHANGELOG.md'] = { retire: true };
    fileMap['docs/**/*'] = { retire: true };
    // CI (#265): GitHub runs workflows from the REPO ROOT only, so a per-target
    // .github/workflows/ in a brand monorepo can never fire. It is composed
    // into the brand root below instead — scoped to this app's path.
    fileMap['.github/**/*'] = { skip: true };
  }

  const result = applyDefaults({
    defaultsDir: path.join(rootPathPackage, 'dist', 'defaults'),
    outputDir,
    files: options.files || null,
    fileMap,
    transform: siteTokenTransform,
    logger,
  });

  if (!seed.standalone) {
    composeTargetWorkflows({
      sourceDir: path.join(rootPathPackage, 'dist', 'defaults', '.github', 'workflows'),
      targetDir: outputDir,
      brandRoot: seed.brandRoot,
      transform: (contents, name) => siteTokenTransform(contents, { name }),
      logger: workflowLogger,
    });
  }

  return result;
}

// Main task — the LOCAL half of the retired `omega setup` on the gulp lane
// ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)). A full pass runs
// ensureTarget (scripts, node check, peer deps, this scaffold, locality), so
// `npm start` and every gulp build heal the consumer tree on the way past. The
// watcher's single-file passes re-scaffold that ONE file and nothing else.
async function defaults(complete, changedFile) {
  // Log
  logger.log('Starting...');

  if (changedFile) {
    scaffoldDefaults({ files: [changedFile] });
  } else {
    // Required lazily: ensure-target requires this module back for
    // scaffoldDefaults, and only one of the two can win at load time.
    const { ensureTarget } = require('../../commands/lib/ensure-target.js');
    await ensureTarget({
      projectDir: Manager.getRootPath('project'),
      log: (line) => logger.log(line),
      warn: (line) => logger.warn(line),
    });
  }

  // Log
  logger.log('Finished!');

  // Complete
  return complete();
}

function defaultsWatcher(complete) {
  // Quit if in build mode
  if (Manager.isBuildMode()) {
    watcherLogger.log('Skipping watcher in build mode');
    return complete();
  }

  // Log
  watcherLogger.log('Watching for changes...');

  // Watch for changes
  watch(input, { delay: delay, dot: true })
  .on('change', (changedPath) => {
    watcherLogger.log(`File changed (${changedPath})`);
    // Call defaults with just the changed file
    defaults(() => {}, changedPath);
  });

  // Complete
  return complete();
}

// Default Task
module.exports = series(defaults, defaultsWatcher);
module.exports.scaffoldDefaults = scaffoldDefaults;

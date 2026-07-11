// Libraries
const Manager = new (require('../../build.js'));
const logger = Manager.logger('defaults');
const { watch, series } = require('gulp');
const jetpack = require('fs-jetpack');
const path = require('path');
const { template } = require('node-powertools');
const { applyDefaults } = require('@omega.js/devkit/defaults-engine');

// Load package
const package = Manager.getPackage('main');
const config = Manager.getConfig('project');
const rootPathPackage = Manager.getRootPath('main');

// Get clean versions
const cleanVersions = { versions: package.engines };

// File MAP — rule vocabulary is the devkit defaults engine's (minimatch patterns,
// last-match-wins). Engine built-ins cover what used to be explicit rules here:
// `_.` renames (`_.env` → `.env`), `.gitkeep` dir creation, `.DS_Store` skips,
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

  // Marker-section merges (framework owns Default, consumer owns Custom)
  '_.gitignore': {
    mergeLines: true,
  },
  '_.env': {
    mergeLines: true,
  },

  // Consumer CLAUDE.md uses the same marker-based merge as .env/.gitignore.
  // Must come AFTER `**/*.md` (which sets overwrite: false) — last-match-wins,
  // so this rule's `mergeLines: true` activates the merge path even though the
  // catch-all would otherwise skip.
  'CLAUDE.md': {
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

function siteTokenTransform(contents, item) {
  const ext = path.extname(item.name).toLowerCase().slice(1);
  if (!TEMPLATE_EXTENSIONS.includes(ext)) {
    return contents;
  }

  try {
    return template(contents, { site: config, versions: package.engines }, {
      brackets: ['[', ']'],
    });
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

  // Layer-aware seed (dogfood friction #1): inside a brand monorepo the app
  // config is TARGETS-ONLY — the full template (placeholder brand) would
  // shadow the brand root, and this task's every-build merge would keep
  // re-adding template keys under it. Standalone consumers keep the template.
  const fileMap = { ...FILE_MAP };
  const { resolveSeedMode, renderBrandAppSeed, resolveConfigPath } = require('@omega.js/config');
  if (!resolveSeedMode(outputDir).standalone) {
    if (!resolveConfigPath(outputDir)) {
      jetpack.write(path.join(outputDir, 'config', 'omega.json5'), renderBrandAppSeed('extension'));
    }
    fileMap['config/omega.json5'] = { overwrite: false };
  }

  return applyDefaults({
    defaultsDir: path.join(rootPathPackage, 'dist', 'defaults'),
    outputDir,
    files: options.files || null,
    fileMap,
    transform: siteTokenTransform,
    logger,
  });
}

// Main task
function defaults(complete, changedFile) {
  // Log
  logger.log('Starting...');

  // Use changedFile if provided, otherwise process the whole defaults tree
  scaffoldDefaults({ files: changedFile ? [changedFile] : null });

  // Log
  logger.log('Finished!');

  // Complete
  return complete();
}

function defaultsWatcher(complete) {
  // Quit if in build mode
  if (Manager.isBuildMode()) {
    logger.log('[watcher] Skipping watcher in build mode');
    return complete();
  }

  // Log
  logger.log('[watcher] Watching for changes...');

  // Watch for changes
  watch(input, { delay: delay, dot: true })
  .on('change', (changedPath) => {
    logger.log(`[watcher] File changed (${changedPath})`);
    // Call defaults with just the changed file
    defaults(() => {}, changedPath);
  });

  // Complete
  return complete();
}

// Default Task
module.exports = series(defaults, defaultsWatcher);
module.exports.scaffoldDefaults = scaffoldDefaults;

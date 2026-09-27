/**
 * `omega migrate` at a brand root: the ONE verb that converts a legacy brand.
 * A bare run reports and writes nothing; `--execute` converts; `--target=`
 * narrows the target walk. The config pass judges every authored omega file,
 * the `.env` pass every `.env` the loader reads (names only, never a value),
 * then each selected target runs its own migration (lib/migrate-walk.js); a
 * brand root omega file a leg merged into (or created) is judged again, and
 * the brand config is loaded the way a build loads it. The report ends on the
 * breaking-changes register. A report exits 1 while anything is due or
 * refused; `--execute` exits 1 on a refusal, on a key the strict schema still
 * refuses, or on a config the loader refuses. The rule set, src/migrate/, is
 * the only code that knows an old name.
 */
const fs = require('node:fs');
const path = require('node:path');
const chalk = require('chalk').default;

const { loadConfig, resolveConfigPath, TARGETS } = require('@omega.js/config');
const { layerFiles, authoredConfigFiles, migrateConfigFile } = require('../migrate/config-pass.js');
const { envFiles, migrateEnv } = require('../migrate/env-pass.js');
const { resolveBrandRoot, discoverTargets, loadBrand } = require('../lib/brand.js');
const { PICKER_FLAG, assertPickerFlags, selectTargets } = require('../lib/target-selection.js');
const { resolveFrameworkPackage } = require('../lib/framework-bin.js');
const { walkMigrations, printBlock } = require('../lib/migrate-walk.js');

module.exports = async (options = {}) => {
  assertPickerFlags(options);

  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree) — run `omega migrate` at the brand root.'));
    process.exitCode = 1;
    return;
  }

  // The picker refuses an unknown name BEFORE anything is written
  const targets = discoverTargets(brandRoot).filter((entry) => entry.target || entry.custom);
  const { selected } = selectTargets({ targets, target: options[PICKER_FLAG] });

  const execute = options.execute === true;
  console.log(chalk.bold(`\nOMEGA migrate: ${brandRoot} ${chalk.dim(execute ? '(converting)' : '(report only: --execute converts)')}`));

  const baseFile = resolveConfigPath(brandRoot);
  const configBlocks = authoredConfigFiles(baseFile, targets).map((authored) => ({ heading: path.relative(brandRoot, authored.file), ...migrateConfigFile(authored, execute) }));
  const envBlocks = envFiles(brandRoot, targets).map((envPath) => ({ heading: path.relative(brandRoot, envPath), ...migrateEnv(envPath, execute) }));

  // The config pass runs first, so a leg's merge meets the root's current key
  // names; a root file a leg then wrote is judged as it now stands.
  const rootFiles = layerFiles(path.dirname(baseFile));
  const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  const rootBefore = rootFiles.map(read);
  const targetBlocks = walkMigrations(selected, { execute, brandRoot });
  rootFiles.forEach((file, index) => {
    if (read(file) !== rootBefore[index]) rejudge(configBlocks, path.relative(brandRoot, file), file, execute);
  });
  const loadBlocks = [loadBlock(brandRoot, targets)];

  for (const block of configBlocks) printBlock(block, 'no retired keys: this config is current');
  for (const block of envBlocks) printBlock(block, 'no retired env keys');
  for (const block of targetBlocks) printBlock(block, 'nothing to migrate');
  for (const block of loadBlocks) printBlock(block, 'the brand config loads');
  const blocks = [...configBlocks, ...envBlocks, ...targetBlocks, ...loadBlocks];

  const count = (key) => blocks.reduce((sum, block) => sum + (Array.isArray(block[key]) ? block[key].length : block[key] || 0), 0);
  const [due, changed, errors] = [count('due'), count('changed'), count('errors')];
  console.log(`\n${due} due, ${changed} changed, ${errors} ${errors === 1 ? 'error' : 'errors'}`);
  console.log(`By-hand steps for every shape OMEGA changed after a conversion: ${registerPath(brandRoot)}`);

  // A key the strict schema refuses still fails the brand's load, so it fails the run in both modes
  if (errors > 0 || (!execute && due > 0) || count('undeclared') > 0) process.exitCode = 1;
};

/**
 * Load the brand config as a build would, once every file is in its final
 * state: the brand root through the manage walk's loadBrand, then each
 * framework target. Every error the loader throws or returns is one line,
 * and a message a second load repeats (the brand file read again) prints once.
 * @param {string} brandRoot
 * @param {Array<object>} targets - discoverTargets entries.
 * @returns {{ heading: string, due: string[], changed: string[], errors: string[] }}
 */
function loadBlock(brandRoot, targets) {
  const seen = new Set();
  const errors = [];
  const add = (where, message) => {
    if (seen.has(message)) return;
    seen.add(message);
    errors.push(`${where}: ${message}`);
  };

  const brand = loadBrand(brandRoot);
  if (brand.configError) add('brand', brand.configError);
  for (const message of brand.configErrors) add('brand', message);

  for (const entry of targets.filter((target) => TARGETS.includes(target.target))) {
    try {
      for (const message of loadConfig(entry.path, entry.target).errors) add(entry.name, message);
    } catch (error) {
      add(entry.name, error.message);
    }
  }

  return { heading: 'config load', due: [], changed: [], errors };
}

/**
 * Judge a brand root omega file again after a leg merged into it: what the
 * first pass changed stands, and the second pass's findings replace the first's.
 * A file the leg created gets its first block, after the root's others.
 * @param {object[]} blocks - The config-pass blocks, updated in place.
 * @param {string} heading - The file, relative to the brand root.
 * @param {string} file
 * @param {boolean} execute
 */
function rejudge(blocks, heading, file, execute) {
  const again = migrateConfigFile({ file }, execute);
  const block = blocks.find((entry) => entry.heading === heading);
  if (block) {
    Object.assign(block, { changed: [...block.changed, ...again.changed], due: again.due, errors: again.errors, undeclared: again.undeclared });
    return;
  }
  const after = blocks.findLastIndex((entry) => !entry.heading.startsWith('targets'));
  blocks.splice(after + 1, 0, { heading, ...again });
}

/**
 * The register the report points at: the copy inside the installed manager.
 * A brand-shaped root with no installed manager runs this bundled one (the
 * dispatcher's documented fallback), so its own copy is the one that matches.
 * @param {string} brandRoot
 * @returns {string}
 */
function registerPath(brandRoot) {
  const installed = resolveFrameworkPackage(brandRoot, '@omega.js/manager');
  const root = installed ? fs.realpathSync(installed.dir) : path.join(__dirname, '..', '..');
  return path.join(root, 'docs', 'shared', 'breaking-changes.md');
}

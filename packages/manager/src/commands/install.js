/**
 * `omega install` (`omega i`) at a brand root: flip the whole brand tree's
 * `@omega.js/*` specs in ONE call, never once per target.
 *
 *   omega i local        → file:-link every @omega.js dep from the local monorepo (one tree install)
 *   omega i live         → restore every file: spec to its exact registry version (the default)
 *   omega i <kind> --dry-run → print the plan, write and install nothing
 *
 * Both halves are devkit's (`linkLocalPackages`, `restoreRegistrySpecs`), which
 * walk every target from the brand root themselves. Either flip then sets the
 * brand's omega plugin copy; `local` also makes it this machine's default.
 */
const chalk = require('chalk').default;

const Logger = require('@omega.js/devkit/logger');
const local = require('@omega.js/devkit/local');
const { resolveBrandRoot } = require('../lib/brand.js');
const { ensureClaudeSettings, SETTINGS_FILE, LOCAL_SETTINGS_FILE, PLUGIN_ID, LOCAL_PLUGIN_ID } = require('../lib/claude-settings.js');
const { ensureLocalDefault } = require('../lib/claude-machine.js');

const LOCAL_KINDS = ['local', 'l', 'dev', 'd', 'development'];
const LIVE_KINDS = ['live', 'prod', 'p', 'production'];

const logger = new Logger('install');

/**
 * Point the brand's Claude settings at the copy of the omega plugin its new
 * install calls for, so the swap needs no other step.
 * @param {string} brandRoot - The brand root
 */
function swapPlugin(brandRoot) {
  const { committed, local: privateFile } = ensureClaudeSettings(brandRoot);
  for (const [file, verdict] of [[SETTINGS_FILE, committed], [LOCAL_SETTINGS_FILE, privateFile]]) {
    if (verdict === 'invalid') {
      logger.warn(`${file} is not valid JSON: fix it so the omega plugin can be set there.`);
    }
  }
  logger.log(`Claude plugin: ${privateFile === 'written' || privateFile === 'present' ? `the local copy (${LOCAL_PLUGIN_ID})` : `the published copy (${PLUGIN_ID})`} loads in this brand.`);
}

/**
 * Make the local copy this machine's default. A failing `claude` is the
 * machine's, never the link's, so it warns and the verb goes on.
 * @param {string} monorepoRoot - The checkout the brand is linked to
 * @param {Function} [claudeExec] - The `claude` runner (the real one by default)
 */
function switchMachine(monorepoRoot, claudeExec) {
  try {
    const machine = ensureLocalDefault({ exec: claudeExec, monorepoRoot });
    if (machine.warning) {
      logger.warn(`Could not register the local omega plugin with Claude Code: ${machine.warning}`);
    }
    if (machine.settings === 'invalid') {
      logger.warn(`Your Claude user settings are not valid JSON: fix them so the local omega plugin (${LOCAL_PLUGIN_ID}) can be this machine's default.`);
    } else if (machine.claude) {
      logger.log(`Claude plugin: the local copy (${LOCAL_PLUGIN_ID}) is this machine's default, the published copy (${PLUGIN_ID}) is off for the user.`);
    }
  } catch (error) {
    logger.warn(`Could not check the Claude plugin on this machine: ${String(error.message).split('\n')[0]}`);
  }
}

module.exports = async (options = {}) => {
  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree): run `omega i local` or `omega i live` at the brand root.'));
    process.exitCode = 1;
    return;
  }

  // `omega i local` puts the kind after the verb; a flag spelling (`--install local`) carries it as the flag's value
  const kind = (options._ || [])[1] ?? [options.install, options.i].find((value) => typeof value === 'string') ?? 'live';
  const dryRun = !!(options['dry-run'] || options.dryRun);
  const plan = dryRun ? ' (dry run: nothing is written or installed)' : '';

  if (LOCAL_KINDS.includes(kind)) {
    const monorepoRoot = local.resolveMonorepoRoot();
    logger.log(`Linking every @omega.js package in ${brandRoot} from ${monorepoRoot}${plan}...`);
    const actions = await local.linkLocalPackages({ dir: brandRoot, monorepoRoot, logger, dryRun });
    const linked = actions.filter((action) => action.action === 'link').length;
    logger.log(linked > 0 ? `${dryRun ? 'Would link' : 'Linked'} ${linked} package(s).` : 'Already linked: nothing to do.');
    if (!dryRun) {
      swapPlugin(brandRoot);
      switchMachine(monorepoRoot, options.claudeExec);
    }
    return;
  }

  if (LIVE_KINDS.includes(kind)) {
    logger.log(`Restoring registry specs across ${brandRoot}${plan}...`);
    const actions = await local.restoreRegistrySpecs({ dir: brandRoot, logger, dryRun });
    const flipped = actions.filter((action) => action.action === 'flip').length;
    logger.log(flipped > 0 ? `${dryRun ? 'Would restore' : 'Restored'} ${flipped} spec(s) to registry versions.` : 'Already on registry specs: nothing to flip.');
    if (!dryRun) {
      swapPlugin(brandRoot);
    }
    return;
  }

  console.error(chalk.red(`✗ Unknown install kind "${kind}": \`omega i\` takes local (${LOCAL_KINDS.join(', ')}) or live (${LIVE_KINDS.join(', ')}).`));
  process.exitCode = 1;
};

module.exports.LOCAL_KINDS = LOCAL_KINDS;
module.exports.LIVE_KINDS = LIVE_KINDS;

/**
 * `omega install` (`omega i`) at a brand root: flip the whole brand tree's
 * `@omega.js/*` specs in ONE call, never once per target.
 *
 *   omega i local        → file:-link every @omega.js dep from the local monorepo (one tree install)
 *   omega i live         → restore every file: spec to its exact registry version (the default)
 *   omega i <kind> --dry-run → print the plan, write and install nothing
 *
 * Both halves are devkit's (`linkLocalPackages`, `restoreRegistrySpecs`), which
 * walk every target from the brand root themselves.
 */
const chalk = require('chalk').default;

const Logger = require('@omega.js/devkit/logger');
const local = require('@omega.js/devkit/local');
const { resolveBrandRoot } = require('../lib/brand.js');

const LOCAL_KINDS = ['local', 'l', 'dev', 'd', 'development'];
const LIVE_KINDS = ['live', 'prod', 'p', 'production'];

const logger = new Logger('install');

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
    return;
  }

  if (LIVE_KINDS.includes(kind)) {
    logger.log(`Restoring registry specs across ${brandRoot}${plan}...`);
    const actions = await local.restoreRegistrySpecs({ dir: brandRoot, logger, dryRun });
    const flipped = actions.filter((action) => action.action === 'flip').length;
    logger.log(flipped > 0 ? `${dryRun ? 'Would restore' : 'Restored'} ${flipped} spec(s) to registry versions.` : 'Already on registry specs: nothing to flip.');
    return;
  }

  console.error(chalk.red(`✗ Unknown install kind "${kind}": \`omega i\` takes local (${LOCAL_KINDS.join(', ')}) or live (${LIVE_KINDS.join(', ')}).`));
  process.exitCode = 1;
};

module.exports.LOCAL_KINDS = LOCAL_KINDS;
module.exports.LIVE_KINDS = LIVE_KINDS;

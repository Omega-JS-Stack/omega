/**
 * `omega bump` at a brand root: move the brand's ONE version
 * ([#869](https://github.com/Omega-JS-Stack/omega/issues/869)).
 *
 *   omega bump          → print the brand's version and stop
 *   omega bump patch    → 0.1.0 → 0.1.1, in the root AND every target
 *   omega bump minor    → 0.1.0 → 0.2.0
 *   omega bump major    → 0.1.0 → 1.0.0
 *
 * The brand root package.json `version` is the master; every target's follows
 * it, and every framework's `omega deploy` refuses a target that drifted. This
 * verb is the ONE writer (`@omega.js/devkit/brand-version`, shared so the
 * writer and the deploy gate read one rule).
 *
 * The NAME is deliberate: `omega update` moves dependencies and `omega version`
 * prints the installed omega, so neither could also mean this.
 *
 * It never commits and never tags: the ship flow owns the `chore(release)`
 * commit that carries the bump and the CHANGELOG move together.
 */
const chalk = require('chalk').default;

const Logger = require('@omega.js/devkit/logger');
const { readBrandVersion, bumpBrandVersion, KINDS } = require('@omega.js/devkit/brand-version');
const { resolveBrandRoot, loadBrand } = require('../lib/brand.js');

const logger = new Logger('bump');

module.exports = async (options = {}) => {
  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✗ Not inside a brand monorepo (no config/omega.json5 up the tree): run `omega bump` at the brand root.'));
    process.exitCode = 1;
    return;
  }

  const kind = (options._ || [])[1];
  if (kind !== undefined && !KINDS.includes(kind)) {
    console.error(chalk.red(`✗ Unknown bump "${kind}": \`omega bump\` takes ${KINDS.join(', ')}.`));
    process.exitCode = 1;
    return;
  }

  const brand = loadBrand(brandRoot);

  // A bare run REPORTS: the brand's number, and nothing written. Reading it
  // through the same module the bump writes with means the print can never
  // name a version the bump would disagree with.
  if (!kind) {
    console.log(`${brand.id} v${readBrandVersion({ dir: brandRoot }).version}`);
    return;
  }

  console.log(chalk.bold(`\nOMEGA brand bump ${chalk.dim(`(${brand.id}, ${kind})`)}`));

  const { previous, next, files } = bumpBrandVersion({ brandRoot, kind, logger });

  console.log(`  ${chalk.green('✓')} ${brand.id} ${chalk.cyan(`${previous} -> ${next}`)} ${chalk.dim(`(${files.length} file${files.length === 1 ? '' : 's'})`)}`);
  console.log(chalk.dim('  Nothing committed and nothing tagged: the ship flow owns the chore(release) commit.'));
};

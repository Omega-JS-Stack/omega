/**
 * `omega company init`: the ONE command that creates a company's shared tree
 * ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)).
 *
 * A company is not a separate repo and not a machine cache: it is the
 * `company/` folder INSIDE the brand that IS the company (`company: { id:
 * 'self' }`), shaped like a brand. The config layer every brand of the company
 * inherits, the `.env` that loads under every brand's own, the shared Apple
 * signing tree and the shared PSD templates all live there, and
 * @omega.js/config's ONE resolver reads them by relative path.
 *
 * Joining is the child's single `company: { id }` key, so there is nothing
 * else to run: no stamp, no adopt, no workspace.
 *
 * Idempotent: a rerun fills gaps only, existing files are never touched.
 */

const path = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { resolveCompany, COMPANY_DIR, COMPANY_SELF } = require('@omega.js/config');

const { resolveBrandRoot } = require('./lib/brand.js');
const { applyScaffoldPlan, printPlanResults } = require('./lib/scaffold.js');
const { COMPANY_DIRS, buildCompanyScaffoldPlan } = require('./lib/company-scaffold.js');

/**
 * Create the directories the tree owns (the signing tree, the shared
 * templates). Empty dirs carry no bytes, so this is a no-op on every rerun.
 *
 * @param {string} companyDir - The `company/` dir.
 * @returns {string[]} The dirs that did not exist yet.
 */
function ensureCompanyDirs(companyDir) {
  const created = [];

  for (const relative of COMPANY_DIRS) {
    const target = path.join(companyDir, relative);
    if (!jetpack.exists(target)) {
      created.push(relative);
    }
    jetpack.dir(target);
  }

  return created;
}

/**
 * Scaffold the `company/` tree inside the brand containing `cwd`.
 *
 * @param {string} cwd - Where the command ran (any dir inside the brand).
 * @returns {{ brandRoot: string, companyDir: string, created: string[], kept: string[], planned: string[], dirs: string[] }}
 */
function runCompanyInit(cwd) {
  const brandRoot = resolveBrandRoot(cwd);
  if (!brandRoot) {
    throw new Error(
      `No brand found at or above ${cwd}: expected a config/omega.json5 at the brand root (see docs/shared/config.md).`,
    );
  }

  // Only the company brand itself owns a company tree: every other brand
  // JOINS one by naming it, and a tree in a child would never be read.
  const company = resolveCompany(brandRoot);
  if (company.id !== COMPANY_SELF) {
    throw new Error(
      `${brandRoot} is not the company brand. Set company: { id: "${COMPANY_SELF}" } in config/omega.json5 first`,
    );
  }

  const companyDir = path.join(brandRoot, COMPANY_DIR);
  const name = company.name || path.basename(brandRoot);

  console.log(chalk.bold.cyan('OMEGA Manager: Company tree'));
  console.log('');
  console.log(`${chalk.dim('→')} ${chalk.cyan(companyDir)}`);
  console.log('');

  const results = applyScaffoldPlan(companyDir, buildCompanyScaffoldPlan(name));
  printPlanResults(results);

  const dirs = ensureCompanyDirs(companyDir);
  for (const relative of dirs) {
    console.log(`  ${chalk.green('✓')} created ${chalk.cyan(`${relative}/`)}`);
  }

  console.log('');
  console.log(chalk.bold('Next steps'));
  console.log(`  ${chalk.dim('1.')} Fill in ${chalk.cyan(path.join(COMPANY_DIR, 'config', 'omega.json5'))} ${chalk.dim('(every key there is a default its brands inherit')}`);
  console.log(`  ${chalk.dim('2.')} Put the shared secrets in ${chalk.cyan(path.join(COMPANY_DIR, '.env'))} ${chalk.dim('(it loads under every brand\'s own)')}`);
  console.log(`  ${chalk.dim('3.')} In each brand of the company: ${chalk.cyan('company: { id: "<this brand\'s brand.id>" }')} ${chalk.dim('in its own config/omega.json5')}`);
  console.log('');

  return { brandRoot, companyDir, ...results, dirs };
}

module.exports = { runCompanyInit };

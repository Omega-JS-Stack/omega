/**
 * `omega company init` and `omega company adopt` — the COMPANY rung in two
 * commands.
 *
 * A company workspace is a REPO, not a machine cache (machine-wide state stays
 * in ~/.omega): the config layer every brand inherits, the `.env` that loads
 * under every brand's own, and the shared Apple signing tree. `init`
 * scaffolds that repo in one command; `adopt` is the ONE step a brand needs
 * to join it — the `.omega/company.json` stamp the config layer already
 * resolves (lib/company.js), which is what makes a brand-local run layer the
 * company config, load the company `.env`, and share the signing tree.
 *
 * Both are idempotent: init fills gaps only (existing files are never
 * touched) and adopt rewrites nothing when the marker already points here.
 */

const fs = require('node:fs');
const path = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { hasOmegaConfig } = require('@omega.js/config');

const { applyScaffoldPlan, printPlanResults } = require('./lib/scaffold.js');
const { COMPANY_DIRS, buildCompanyScaffoldPlan } = require('./lib/company-scaffold.js');
const {
  isCompanyRoot,
  resolveManageRoot,
  discoverBrands,
  loadCompanyConfig,
  stampCompanyMarker,
} = require('./lib/company.js');

/**
 * Create the directories a company workspace owns (the signing tree, the
 * default brands root). Empty dirs carry no bytes, so this is a no-op on
 * every rerun.
 *
 * @returns {string[]} - The dirs that did not exist yet
 */
function ensureCompanyDirs(companyRoot) {
  const created = [];

  for (const relative of COMPANY_DIRS) {
    const target = path.join(companyRoot, relative);
    if (!jetpack.exists(target)) {
      created.push(relative);
    }
    jetpack.dir(target);
  }

  return created;
}

/**
 * Scaffold a company workspace at `dir`.
 *
 * @param {string} dir - Absolute directory to make a company root
 * @returns {{ companyRoot: string, created: string[], kept: string[], dirs: string[] }}
 */
function runCompanyInit(dir) {
  const companyRoot = path.resolve(dir);
  const name = path.basename(companyRoot);

  console.log(chalk.bold.cyan('OMEGA Manager — Company workspace'));
  console.log('');
  console.log(`${chalk.dim('→')} ${chalk.cyan(companyRoot)}`);
  console.log('');

  const results = applyScaffoldPlan(companyRoot, buildCompanyScaffoldPlan(name));
  printPlanResults(results);

  const dirs = ensureCompanyDirs(companyRoot);
  for (const relative of dirs) {
    console.log(`  ${chalk.green('✓')} created ${chalk.cyan(`${relative}/`)}`);
  }

  // Prove it is actually a company root before calling it done — the `brands`
  // key is what every other verb detects, and the layer must parse
  const layer = loadCompanyConfig(companyRoot);
  console.log('');
  if (isCompanyRoot(companyRoot)) {
    const keys = Object.keys(layer);
    console.log(`${chalk.green('✓')} Company config loads ${chalk.dim(keys.length > 0 ? `(brands inherit: ${keys.join(', ')})` : '(no inherited keys yet — every section is commented out)')}`);
  } else {
    console.log(`${chalk.red('✗')} config/omega.json5 has no \`brands\` key — this directory will not be treated as a company root`);
  }

  console.log('');
  console.log(chalk.bold('Next steps'));
  console.log(`  ${chalk.dim('1.')} Fill in ${chalk.cyan('config/omega.json5')} — every key there is a default its brands inherit`);
  console.log(`  ${chalk.dim('2.')} Put the shared secrets in ${chalk.cyan('.env')} ${chalk.dim('(it loads under every brand\'s own)')}`);
  console.log(`  ${chalk.dim('3.')} ${chalk.cyan('npx omega company adopt <brand-path>')} ${chalk.dim('— per existing brand (or `npx omega onboard` for a new one)')}`);
  console.log(`  ${chalk.dim('4.')} ${chalk.cyan('npx omega manage')} ${chalk.dim('— the full walk, once per managed brand')}`);
  console.log('');

  return { companyRoot, ...results, dirs };
}

/**
 * Adopt a brand into the company workspace containing `cwd`: stamp its
 * `.omega/company.json`, the ONE step a brand needs.
 *
 * @param {string} cwd - Where the command ran (must resolve to a company root)
 * @param {string} brandPath - The brand root to adopt (relative to cwd or absolute)
 * @returns {{ companyRoot: string, brandRoot: string, stamped: boolean, managed: boolean }}
 */
function runCompanyAdopt(cwd, brandPath) {
  const resolved = resolveManageRoot(cwd);
  if (!resolved?.isCompany) {
    throw new Error(
      'Not inside a company workspace — run `omega company init` here first '
      + '(a company root is a directory whose config/omega.json5 has a `brands` key)',
    );
  }
  if (!brandPath) {
    throw new Error('Usage: omega company adopt <brand-path>');
  }

  const companyRoot = resolved.root;
  const brandRoot = path.resolve(cwd, brandPath);

  if (!hasOmegaConfig(brandRoot)) {
    throw new Error(`Not a brand: ${brandRoot} — a brand root has a config/omega.json5`);
  }
  if (isCompanyRoot(brandRoot)) {
    throw new Error(`${brandRoot} is a company workspace, not a brand — the hierarchy is one rung: company → brands`);
  }

  const stamped = stampCompanyMarker(brandRoot, companyRoot);

  console.log(`${chalk.dim('→')} Company workspace: ${chalk.cyan(companyRoot)}`);
  if (stamped) {
    console.log(`${chalk.green('✓')} adopted ${chalk.cyan(brandRoot)} ${chalk.dim('→ .omega/company.json')}`);
  } else {
    console.log(`${chalk.dim('•')} ${chalk.dim(brandRoot)} ${chalk.dim('already adopted (marker unchanged)')}`);
  }

  const inherited = Object.keys(loadCompanyConfig(companyRoot));
  console.log(`  ${chalk.dim(inherited.length > 0 ? `inherits: ${inherited.join(', ')} (+ the company .env, + the shared signing tree)` : 'inherits: the company .env + the shared signing tree (its config sets no keys yet)')}`);

  // The stamp is enough for BRAND-LOCAL runs, but a company-wide `omega
  // manage` only walks what brands.roots discovers — say so rather than let
  // an adopted-but-undiscovered brand look managed
  const managed = isDiscovered(companyRoot, brandRoot);
  if (!managed) {
    console.log(chalk.yellow(`⚠ ${brandRoot} is outside this company's brands.roots — it inherits the company layer on its own runs, but company-wide runs won't include it (add its parent dir to brands.roots)`));
  }

  return { companyRoot, brandRoot, stamped, managed };
}

/**
 * Does a company-wide run walk this brand? Discovery reads config, so a
 * broken/incomplete brands.roots is reported by the run itself, never by
 * adopt — an undiscoverable company simply can't answer the question.
 */
function isDiscovered(companyRoot, brandRoot) {
  try {
    const real = fs.realpathSync(brandRoot);
    return discoverBrands(companyRoot).brands.some((brand) => fs.realpathSync(brand.root) === real);
  } catch {
    return true;
  }
}

module.exports = { runCompanyInit, runCompanyAdopt };

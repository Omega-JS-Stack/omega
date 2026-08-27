/**
 * `omega onboard` — the brand-creation wizard: collect the brand's
 * identity (flags win, prompts fill the gaps in a TTY, derivation covers the
 * rest), scaffold the plan-§0 brand-monorepo skeleton, prove the config
 * loads, then optionally hand off to manage.
 *
 * Context-sensitive on where it runs, mirroring manage:
 *   inside a company workspace → the new brand lands under brands.roots[0]
 *                                (or a selected root) + gets the company stamp
 *   inside an existing brand   → resume: no wizard, answers come from the
 *                                brand's own config, only MISSING files fill in
 *   anywhere else              → in-place: the cwd becomes the brand root
 *                                (the "Use this template" story — clone, onboard)
 *
 * Non-interactive runs derive everything derivable from --id (name, url,
 * email) and use the web+backend target default; only a missing, underivable
 * id is an error. --dry-run never prompts and never writes — it prints the
 * file plan. Scaffolding never overwrites: rerunning onboard converges.
 */

const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const { input, select, checkbox, confirm } = require('@omega.js/devkit/prompt');
const { TARGETS, hasOmegaConfig } = require('@omega.js/config');

const { TARGET_DIRS, TARGET_FRAMEWORKS, DEFAULTS } = require('./config.js');
const { DEFAULT_BRAND_ROOTS, resolveManageRoot, readRawConfig, stampCompanyMarker } = require('./lib/company.js');
const { loadBrand } = require('./lib/brand.js');
const { buildScaffoldPlan, applyScaffoldPlan, printPlanResults } = require('./lib/scaffold.js');
const { canPrompt } = require('./lib/run-gates.js');
const { deriveBundleIdPrefix } = require('./lib/bundle-id.js');
const { convertLegacyOAuthSecret } = require('./lib/legacy-oauth.js');

// New-brand ids are a conservative subset of the schema's brand.id pattern —
// always dir-, repo-, and URL-scheme-safe.
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const ID_HINT = 'lowercase letters, numbers, dashes; starts with a letter';

const DEFAULT_TARGETS = ['web', 'backend'];

/**
 * Derive a valid brand id from a directory name ('My Brand 2' → 'my-brand-2');
 * null when nothing valid survives.
 */
function deriveId(dirName) {
  const id = String(dirName)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '');

  return ID_PATTERN.test(id) ? id : null;
}

/** 'acme-demo' → 'Acme Demo' */
function deriveName(id) {
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** omega-manager's onboarding default: dashes drop out of the domain. */
function deriveUrl(id) {
  return `https://${id.replace(/-/g, '')}.com`;
}

function deriveEmail(url) {
  const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return `support@${host}`;
}

/**
 * Normalize a --targets flag value ('web,backend' or array) and validate
 * every entry against the canonical target list.
 */
function parseTargetsFlag(value) {
  const targets = Array.isArray(value) ? value : String(value).split(',');
  const cleaned = targets.map((t) => t.trim()).filter(Boolean);

  const unknown = cleaned.filter((t) => !TARGETS.includes(t));
  if (unknown.length > 0) {
    throw new Error(`Unknown target(s): ${unknown.join(', ')} — valid targets: ${TARGETS.join(', ')}`);
  }
  if (cleaned.length === 0) {
    throw new Error(`--targets needs at least one of: ${TARGETS.join(', ')}`);
  }

  return cleaned;
}

/**
 * The admin-account list a fresh brand would inherit without writing
 * anything: the company config's account.admins when onboarding into a
 * company workspace, else the manager's built-in default.
 */
function inheritedAdmins(companyRoot) {
  const companyAdmins = companyRoot ? readRawConfig(companyRoot)?.account?.admins : null;

  return Array.isArray(companyAdmins) && companyAdmins.length > 0
    ? { list: companyAdmins, source: 'company config' }
    : { list: DEFAULTS.account.admins, source: 'built-in default' };
}

/**
 * The accounts step: show the list the brand inherits and let the owner
 * keep it (nothing written — the source layer keeps owning it) or define
 * the brand's own, which lands as account.admins in its omega.json5.
 *
 * @returns {Array|null} Customized entries, or null to inherit
 */
async function collectAccountAdmins(inherited, interactive) {
  if (!interactive) {
    return null;
  }

  console.log('');
  console.log(`  Managed accounts the brand inherits ${chalk.dim(`(${inherited.source})`)}:`);
  for (const entry of inherited.list) {
    const flags = [entry.account && 'account', entry.marketing && 'marketing'].filter(Boolean).join(' + ');
    console.log(`    ${chalk.dim('•')} ${chalk.cyan(entry.email)} ${chalk.dim(`(${flags || 'nothing managed'})`)}`);
  }

  const keep = await confirm({
    message: 'Keep this account list? (customizing writes account.admins into the brand config)',
    default: true,
  });
  if (keep) {
    return null;
  }

  const entries = [];
  do {
    const email = (await input({
      message: `Account email (${'{domain}'} = brand domain):`,
      ...(entries.length === 0 ? { default: 'support@{domain}' } : {}),
      validate: (value) => (value.trim().includes('@') ? true : 'Must be an email address'),
    })).trim();
    const account = await confirm({ message: 'Manage the Firebase Auth account (create + admin role + top plan)?', default: true });
    const marketing = await confirm({ message: 'Sync the contact to marketing providers?', default: true });
    entries.push({ email, account, marketing });
  } while (await confirm({ message: 'Add another account?', default: false }));

  return entries;
}

/**
 * Collect the wizard answers for a FRESH brand: flags win, prompts fill the
 * gaps interactively, derivation covers the rest. `defaultId` comes from the
 * in-place directory name (null in company mode); `companyRoot` (when
 * onboarding into a company workspace) supplies the inherited account list.
 */
async function collectAnswers(options, defaultId, interactive, companyRoot = null) {
  // id — the only field with no universal derivation
  let id = options.id ?? null;
  if (id != null && !ID_PATTERN.test(String(id))) {
    throw new Error(`Invalid brand id ${JSON.stringify(String(id))} — ${ID_HINT}`);
  }
  if (!id) {
    if (interactive) {
      id = await input({
        message: 'Brand ID:',
        ...(defaultId ? { default: defaultId } : {}),
        validate: (value) => (ID_PATTERN.test(value.trim()) ? true : `Must be ${ID_HINT}`),
      });
      id = id.trim();
    } else if (defaultId) {
      id = defaultId;
    } else {
      throw new Error('Brand id required — pass --id=<id> (or run in an interactive terminal)');
    }
  }

  // name / url — derivable from the id
  let name = options.name ?? null;
  if (!name) {
    name = interactive
      ? (await input({
        message: 'Brand name:',
        default: deriveName(id),
        validate: (value) => (value.trim().length > 0 ? true : 'Required'),
      })).trim()
      : deriveName(id);
  }

  let url = options.url ?? null;
  if (url != null && !/^https?:\/\//.test(String(url))) {
    throw new Error(`Invalid brand url ${JSON.stringify(String(url))} — must start with http(s)://`);
  }
  if (!url) {
    url = interactive
      ? (await input({
        message: 'Brand URL:',
        default: deriveUrl(id),
        validate: (value) => (/^https?:\/\//.test(value.trim()) ? true : 'Must start with http(s)://'),
      })).trim()
      : deriveUrl(id);
  }

  // description / tagline — optional; empty answers stay out of the config
  let description = options.description ?? null;
  if (description == null && interactive) {
    description = (await input({ message: 'Brand description (optional):' })).trim();
  }

  let tagline = options.tagline ?? null;
  if (tagline == null && interactive) {
    tagline = (await input({ message: 'Brand tagline (optional, ~3 words):' })).trim();
  }

  // targets — checkbox in a TTY, web+backend otherwise
  let targets = options.targets != null ? parseTargetsFlag(options.targets) : null;
  if (!targets) {
    targets = interactive
      ? await checkbox({
        message: 'Targets (key presence in omega.json5 = enabled):',
        choices: TARGETS.map((target) => ({
          name: `${target} — targets/${TARGET_DIRS[target] || target}${TARGET_FRAMEWORKS[target] ? ` (${TARGET_FRAMEWORKS[target]})` : ' (reserved — MAM overhaul pending)'}`,
          value: target,
          checked: DEFAULT_TARGETS.includes(target),
        })),
        validate: (selection) => (selection.length > 0 ? true : 'Select at least one target'),
      })
      : DEFAULT_TARGETS;
  }

  // accounts — inherit by default (null writes nothing); customizing lands
  // the brand's own account.admins
  const accountAdmins = await collectAccountAdmins(inheritedAdmins(companyRoot), interactive);

  // Bundle-id prefix — reverse-DNS of the parent company's domain when
  // onboarding into a company workspace, else the brand's own (seeded into
  // config only for targets that sign apps)
  const companyUrl = companyRoot ? readRawConfig(companyRoot)?.brand?.url : null;

  return {
    id,
    name,
    url,
    description: description || null,
    tagline: tagline || null,
    email: deriveEmail(url),
    targets,
    accountAdmins,
    bundleIdPrefix: deriveBundleIdPrefix(companyUrl || url),
  };
}

/**
 * Resolve where the new brand lives when onboarding from a company root:
 * brands.roots[0], or a selected root when several are configured and the
 * run is interactive.
 */
async function resolveCompanyBrandsDir(companyRoot, interactive) {
  const roots = readRawConfig(companyRoot)?.brands?.roots || DEFAULT_BRAND_ROOTS;

  let rootSpec = roots[0];
  if (roots.length > 1 && interactive) {
    rootSpec = await select({
      message: 'Where should the new brand live?',
      choices: roots.map((r) => ({ value: r })),
    });
  }

  if (path.isAbsolute(rootSpec)) {
    throw new Error(`brands.roots entries must be RELATIVE to the company root — got absolute path: ${rootSpec}`);
  }

  return path.resolve(companyRoot, rootSpec);
}

/**
 * Answers for an EXISTING brand (resume): no wizard — the brand's own config
 * is the source, and the scaffold only fills missing files around it.
 */
function answersFromBrand(brandRoot) {
  const brand = loadBrand(brandRoot);
  if (brand.configError) {
    throw new Error(`This brand's config/omega.json5 does not load: ${brand.configError}`);
  }

  const id = brand.id;
  const url = brand.config.brand?.url || deriveUrl(id);

  return {
    id,
    name: brand.config.brand?.name || deriveName(id),
    url,
    description: brand.config.brand?.description || null,
    tagline: brand.config.brand?.tagline || null,
    email: brand.config.brand?.contact?.email || deriveEmail(url),
    targets: brand.enabledTargets.length > 0 ? brand.enabledTargets : DEFAULT_TARGETS,
    bundleIdPrefix: brand.config.certificates?.providers?.apple?.bundleIdPrefix || deriveBundleIdPrefix(url),
  };
}

/**
 * Ensure the born brand is a git repository: init + stage + first commit
 * when the brand root isn't already inside one (Ian 2026-07-17 — a brand
 * should be committable from minute one, and the extension package task's
 * source-zip step wants a repo). The scaffolded .gitignore is on disk
 * before this runs, so the first commit can never capture .env/.omega.
 * Inside an existing work tree ("Use this template" clones, brands in a
 * monorepo) this is a clean skip.
 *
 * @param {string} brandRoot - The brand root directory
 * @param {string} brandName - Display name for the first-commit message
 * @returns {{ initialized: boolean, committed?: boolean, reason?: string }}
 */
function ensureGitRepo(brandRoot, brandName) {
  const git = (args) => spawnSync('git', args, { cwd: brandRoot, stdio: 'ignore' });

  if (git(['rev-parse', '--is-inside-work-tree']).status === 0) {
    return { initialized: false, reason: 'existing repository' };
  }
  if (git(['init']).status !== 0) {
    return { initialized: false, reason: 'git init failed (is git installed?)' };
  }
  git(['add', '-A']);

  // Commit with the owner's identity; machines without one get a neutral
  // fallback so the first commit never blocks onboarding
  const hasIdentity = git(['config', 'user.email']).status === 0;
  const identity = hasIdentity ? [] : ['-c', 'user.name=OMEGA Onboard', '-c', 'user.email=onboard@localhost'];
  const commit = git([...identity, 'commit', '-m', `Initial commit — ${brandName} born via omega onboard`]);

  return { initialized: true, committed: commit.status === 0 };
}

/** Run manage in the new brand exactly as a user would — a real child process. */
function spawnManage(brandRoot) {
  return new Promise((resolve) => {
    // cli-run.js self-executes when spawned as main — spawning it directly
    // deliberately bypasses the bin's dispatcher (#276): this child must run
    // THIS manager, never re-dispatch on the child's cwd. The verb is
    // explicit (#229): a bare invocation prints help and walks nothing.
    const entry = path.join(__dirname, 'cli-run.js');
    const child = spawn(process.execPath, [entry, 'manage'], { cwd: brandRoot, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

function printNextSteps(answers) {
  console.log('');
  console.log(chalk.bold('Next steps'));

  const frameworks = answers.targets
    .filter((target) => TARGET_FRAMEWORKS[target])
    .map((target) => `${TARGET_FRAMEWORKS[target]} → targets/${TARGET_DIRS[target]}`);
  if (frameworks.length > 0) {
    console.log(`  1. Install each target's framework and run its setup: ${frameworks.join(', ')}`);
  }
  console.log(`  ${frameworks.length > 0 ? 2 : 1}. Fill in .env as the brand adopts external services (the stub lists every key)`);
  console.log(`  ${frameworks.length > 0 ? 3 : 2}. Run ${chalk.cyan('npm run manage')} to reconcile everything — rerun any time`);
}

/**
 * Main onboard runner.
 *
 * @param {string} cwd - Where the command ran
 * @param {Object} options - { id, name, url, description, tagline, targets, dryRun, manage }
 * @returns {Object} - { brandRoot, mode, created, kept, planned, valid, manageExitCode }
 */
async function runOnboard(cwd, options = {}) {
  console.log(chalk.bold.cyan('OMEGA Manager — Onboarding'));
  console.log('');

  const interactive = canPrompt(options);
  const resolved = resolveManageRoot(cwd);

  // Resolve the brand root + answers per context
  let brandRoot;
  let answers;
  let mode;
  let companyRoot = null;

  if (resolved?.isCompany) {
    companyRoot = resolved.root;
    console.log(`${chalk.dim('→')} Company workspace: ${chalk.cyan(companyRoot)}`);

    const brandsDir = await resolveCompanyBrandsDir(companyRoot, interactive);
    answers = await collectAnswers(options, null, interactive, companyRoot);
    brandRoot = path.join(brandsDir, answers.id);

    if (hasOmegaConfig(brandRoot)) {
      console.log(`${chalk.dim('→')} Brand ${chalk.cyan(answers.id)} already exists — filling missing files only`);
      answers = answersFromBrand(brandRoot);
      mode = 'resume';
    } else {
      mode = 'fresh';
    }
  } else if (resolved) {
    brandRoot = resolved.root;
    console.log(`${chalk.dim('→')} Existing brand: ${chalk.cyan(brandRoot)} — filling missing files only`);
    answers = answersFromBrand(brandRoot);
    mode = 'resume';
  } else {
    brandRoot = cwd;
    answers = await collectAnswers(options, deriveId(path.basename(cwd)), interactive);
    mode = 'fresh';
  }

  if (mode === 'fresh') {
    console.log(`${chalk.dim('→')} New brand: ${chalk.cyan(answers.name)} ${chalk.dim(`(${answers.id})`)} → ${chalk.cyan(brandRoot)}`);
  }
  console.log('');

  // Scaffold (fill-missing; dry-run plans only)
  const plan = buildScaffoldPlan(answers);
  const results = applyScaffoldPlan(brandRoot, plan, { dryRun: options.dryRun });
  printPlanResults(results);

  if (options.dryRun) {
    console.log('');
    console.log(chalk.dim('⊘ Dry run — nothing written'));
    return { brandRoot, mode, ...results, valid: true };
  }

  // Port-time conversion: a carried legacy oauth.json becomes the canonical
  // google-oauth.json once, here, so nothing downstream dual-reads it (#501)
  const legacyOAuth = convertLegacyOAuthSecret(brandRoot);
  if (legacyOAuth.converted) {
    console.log(`  ${chalk.green('✓')} google-oauth.json ${chalk.dim('← the carried legacy oauth.json (converted, legacy file removed)')}`);
  } else if (legacyOAuth.reason) {
    console.log(`  ${chalk.yellow('⚠')} legacy oauth.json not converted ${chalk.dim(`(${legacyOAuth.reason})`)}`);
  }

  // Company link — brand-local runs now layer the company defaults
  if (companyRoot) {
    if (stampCompanyMarker(brandRoot, companyRoot)) {
      console.log(`  ${chalk.green('✓')} company stamp ${chalk.dim(`→ .omega/company.json (${companyRoot})`)}`);
    }
  }

  // Prove the brand actually loads before calling it done
  const brand = loadBrand(brandRoot);
  const valid = !brand.configError && brand.configErrors.length === 0;
  console.log('');
  if (valid) {
    console.log(`${chalk.green('✓')} Config loads and validates ${chalk.dim(`(targets: ${brand.enabledTargets.join(', ')})`)}`);
  } else {
    console.log(`${chalk.red('✗')} Config problem: ${brand.configError || brand.configErrors.join('; ')}`);
  }

  // Git — a born brand is committable from minute one
  const git = ensureGitRepo(brandRoot, answers.name);
  if (git.initialized) {
    console.log(`${chalk.green('✓')} git repository initialized ${chalk.dim(git.committed ? '(first commit made)' : '(commit skipped — set your git identity and commit)')}`);
  } else {
    console.log(`${chalk.dim('•')} git ${chalk.dim(`(${git.reason})`)}`);
  }

  printNextSteps(answers);

  // Manage handoff — never in a dry run, never implicitly without a TTY
  let manageExitCode = null;
  const runNow = options.manage
    ?? (interactive && valid
      ? await confirm({ message: 'Run manage now?', default: true })
      : false);

  if (runNow) {
    console.log('');
    console.log(`${chalk.dim('→')} Starting management…`);
    console.log(chalk.dim('━'.repeat(70)));
    manageExitCode = await spawnManage(brandRoot);
  }

  return { brandRoot, mode, ...results, valid, git, legacyOAuth, manageExitCode };
}

module.exports = { runOnboard, deriveId, deriveName, deriveUrl };

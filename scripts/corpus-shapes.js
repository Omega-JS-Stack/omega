/**
 * The brand-SHAPE corpus (cp197, Ian 2026-07-17: "do corpus") — tier A of
 * `npm run test:corpus`, and part of root `npm test` through it.
 *
 * Every cell births a brand through the REAL onboard (in-process, flags
 * mode) in a temp dir, proves the config validates and git initializes,
 * and — for web cells — runs the REAL Eleventy build via the monorepo's own
 * @omega.js/web (the same no-install engine lane the zero-page pin uses)
 * with per-cell invariants: branded homepage, active theme id, /blog,
 * sitemap + robots meta-files, and post listing for the content cell.
 *
 * Fully OFFLINE by construction: no npm installs, no emulators, no live
 * calls (Ian's corpus stance — real code against real local infra only;
 * the outside-monorepo install/boot/manage story is the journey lane's job).
 *
 * Future axes live here: add a cell, not a new harness (company-mode child,
 * extra content shapes, more themes as they're born).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MONOREPO_ROOT = path.join(__dirname, '..');
const { runOnboard } = require(path.join(MONOREPO_ROOT, 'packages', 'manager', 'src', 'onboard.js'));
const { TARGET_APP_DIRS } = require(path.join(MONOREPO_ROOT, 'packages', 'manager', 'src', 'config.js'));
const { configureOmega, loadSiteData } = require('@omega.js/web');

// One row per brand shape. targets: null = the non-interactive derivation
// default (web+backend). theme flips the seeded config. post drops a real
// _posts entry before the build. instances flips targets.web to the
// 2-instance array form and proves the multi-instance sweep (structure,
// per-instance compose, port offsets, deploy-record keys, both builds).
const CELLS = [
  { id: 'shape-web-only', targets: 'web' },
  { id: 'shape-default-derivation', targets: null },
  { id: 'shape-all-four', targets: 'web,backend,desktop,extension' },
  { id: 'shape-newsflash', targets: 'web,backend', theme: 'newsflash' },
  { id: 'shape-backend-only', targets: 'backend' },
  { id: 'shape-desktop-extension', targets: 'desktop,extension' },
  { id: 'shape-with-post', targets: 'web', post: true },
  { id: 'shape-web-two-instance', targets: 'web', instances: true },
];

const POST_MARKER = 'Corpus Post Alpha';

function deriveName(id) {
  return id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function expectedTargets(cell) {
  return cell.targets ? cell.targets.split(',') : ['web', 'backend'];
}

/** Flip the seeded theme id in the cell's config (scaffold seeds classy). */
function flipTheme(brandRoot, themeId) {
  const configPath = path.join(brandRoot, 'config', 'omega.json5');
  const raw = fs.readFileSync(configPath, 'utf8');
  const flipped = raw.replace(/id: "classy"/, `id: "${themeId}"`);
  if (flipped === raw) {
    throw new Error(`could not flip theme to ${themeId} — the scaffold's classy seed line moved`);
  }
  fs.writeFileSync(configPath, flipped);
}

function writePost(webAppDir) {
  const postPath = path.join(webAppDir, '_posts', '2026', '2026-07-01-corpus-post.md');
  fs.mkdirSync(path.dirname(postPath), { recursive: true });
  fs.writeFileSync(postPath, [
    '---',
    'layout: blueprint/blog/post',
    'post:',
    `  title: "${POST_MARKER}"`,
    '  description: "A corpus content-shape post"',
    '  author: corpus',
    '  id: 1000001',
    '  tags: ["corpus"]',
    '  categories: ["Corpus"]',
    '---',
    'Corpus post body.',
    '',
  ].join('\n'));
}

/** Real Eleventy build of a cell's web app (any instance dir); returns results by URL. */
async function buildWebApp(brandRoot, appDirName = 'website') {
  const Eleventy = require('@11ty/eleventy').default;
  const webAppDir = path.join(brandRoot, 'apps', appDirName);
  const siteData = loadSiteData(webAppDir); // the REAL config chain (throws on invalid)

  const elev = new Eleventy(webAppDir, path.join(brandRoot, `.corpus-out-${appDirName}`), {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      // Cells share one process — never let Eleventy's template cache
      // bleed one brand's layouts into the next (slice-test precedent)
      eleventyConfig.setUseTemplateCache(false);
      return configureOmega(eleventyConfig, {
        consumerDir: webAppDir,
        siteData,
        farmDir: path.join(brandRoot, `.corpus-farm-${appDirName}`),
        assetManifest: {
          js: { main: '/assets/js/main-CORPUS.js', pages: {} },
          css: { main: '/assets/css/main-CORPUS.css', pages: {}, themePages: {} },
        },
      });
    },
  });

  const results = await elev.toJSON();
  return new Map(results.map((entry) => [entry.url, entry.content]));
}

function assertWebInvariants(cell, pages) {
  const name = deriveName(cell.id);
  const theme = cell.theme || 'classy';
  const failures = [];
  const need = (condition, label) => { if (!condition) failures.push(label); };

  const home = pages.get('/');
  need(home, 'homepage at /');
  if (home) {
    need(home.includes(name), `homepage branded "${name}"`);
    need(home.includes(`data-theme-id="${theme}"`), `theme ${theme} active`);
  }
  need([...pages.keys()].some((url) => url.startsWith('/blog')), '/blog present');
  need(pages.has('/sitemap.xml'), 'sitemap.xml');
  need(pages.has('/robots.txt'), 'robots.txt');

  if (home) {
    need(home.includes('rel="preload"') && home.includes('as="font"'), 'font preload links present');
  }

  if (cell.post) {
    const blogUrl = [...pages.keys()].find((url) => url.startsWith('/blog'));
    need(blogUrl && pages.get(blogUrl).includes(POST_MARKER), `blog lists "${POST_MARKER}"`);
  }

  return failures;
}

/**
 * The multi-instance proof (plans/multi-instance-targets.md step 3): flip the
 * born brand's targets.web to the 2-instance array form and exercise the
 * whole sweep through the REAL mechanisms — the workspace structure op's
 * per-instance dir expectations, per-instance compose (the admin entry
 * overrides brand shared for admin ONLY), deterministic dev-port offsets,
 * deploy-record keying by app, and a real Eleventy build of BOTH instances.
 */
async function proveInstances(brandRoot, cell) {
  const JSON5 = require('json5');
  const { loadConfig, appInstance, instancePortOffset } = require('@omega.js/config');
  const { loadBrand } = require(path.join(MONOREPO_ROOT, 'packages', 'manager', 'src', 'lib', 'brand.js'));
  const structureOp = require(path.join(MONOREPO_ROOT, 'packages', 'manager', 'src', 'services', 'workspace', 'ensure', 'structure.js'));
  const { websiteWantedPort } = require(path.join(MONOREPO_ROOT, 'packages', 'web', 'src', 'commands', 'dev.js'));
  const { recordDeploy } = require('@omega.js/devkit/deploy-record');

  const failures = [];
  const need = (condition, label) => { if (!condition) failures.push(label); };
  const baseName = deriveName(cell.id);
  const adminName = `${baseName} Admin`;

  // Flip targets.web to the array form: main + an admin instance that
  // overrides brand.name for ITS instance only (comments are corpus-expendable)
  const configPath = path.join(brandRoot, 'config', 'omega.json5');
  const data = JSON5.parse(fs.readFileSync(configPath, 'utf8'));
  data.targets.web = [
    { id: 'main' },
    { id: 'admin', url: `https://admin.${cell.id}.invalid`, brand: { name: adminName } },
  ];
  fs.writeFileSync(configPath, JSON5.stringify(data, null, 2));

  // Structure op (quiet — its console lines are not corpus output): the
  // enabled admin instance without its dir is the create-this-dir error
  const runStructure = async () => {
    const log = console.log;
    console.log = () => {};
    try {
      const brand = loadBrand(brandRoot);
      return await structureOp({ brandRoot, brand, apps: brand.apps });
    } finally {
      console.log = log;
    }
  };
  const missing = await runStructure();
  need(missing.status === 'error' && /create apps\/website-admin\//.test(missing.error || ''), 'structure errors on the missing instance dir');

  // Birth the admin instance as a copy of the main app, then structure heals
  const mainDir = path.join(brandRoot, 'apps', 'website');
  const adminDir = path.join(brandRoot, 'apps', 'website-admin');
  fs.cpSync(mainDir, adminDir, { recursive: true });
  const healed = await runStructure();
  need(healed.status !== 'error', `structure passes with both instance dirs (${healed.error || 'ok'})`);

  // Per-instance compose: the admin entry is scoped to apps/website-admin
  const main = loadConfig(mainDir, 'web');
  const admin = loadConfig(adminDir, 'web');
  need(main.errors.length === 0 && admin.errors.length === 0, 'both instances validate');
  need(main.instance === 'main' && admin.instance === 'admin', 'app dirs resolve their instance ids');
  need(main.config.brand.name === baseName, 'main keeps the brand-shared name');
  need(admin.config.brand.name === adminName, 'admin instance entry overrides brand shared for admin only');
  need(admin.config.url === `https://admin.${cell.id}.invalid`, 'admin carries its instance url');

  // Dev-port offsets: side-by-side capable, deterministic off the same base
  need(instancePortOffset(data.targets.web, 'admin') === 1, 'admin offsets by its array position');
  need(websiteWantedPort(adminDir) - websiteWantedPort(mainDir) === 1, 'admin wants the next port beside main');

  // Deploy records key by app: main stays `web`, admin lands `web:admin`
  recordDeploy({ dir: mainDir, target: 'web', instance: appInstance(mainDir, 'web'), detail: { method: 'corpus' } });
  recordDeploy({ dir: adminDir, target: 'web', instance: appInstance(adminDir, 'web'), detail: { method: 'corpus' } });
  const state = JSON.parse(fs.readFileSync(path.join(brandRoot, '.omega', 'state.json'), 'utf8'));
  need(!!(state.deploy && state.deploy.web && state.deploy['web:admin']), 'deploy records key per instance app');

  // Real Eleventy build of BOTH instances — each branded as ITS instance
  const mainPages = await buildWebApp(brandRoot, 'website');
  const adminPages = await buildWebApp(brandRoot, 'website-admin');
  failures.push(...assertWebInvariants(cell, mainPages));
  const mainHome = mainPages.get('/') || '';
  const adminHome = adminPages.get('/') || '';
  need(!mainHome.includes(adminName), 'main homepage never leaks the admin branding');
  need(adminHome.includes(adminName), `admin homepage branded "${adminName}"`);

  return failures;
}

async function runCell(cell) {
  const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'omega-corpus-'));
  const brandRoot = path.join(tempRoot, cell.id);
  fs.mkdirSync(brandRoot);
  const failures = [];

  try {
    const report = await runOnboard(brandRoot, {
      id: cell.id,
      url: `https://${cell.id}.invalid`,
      ...(cell.targets ? { targets: cell.targets } : {}),
      manage: false,
    });

    if (!report.valid) failures.push('config invalid');
    if (!report.git?.initialized) failures.push('git not initialized');

    const targets = expectedTargets(cell);
    for (const target of targets) {
      const dir = TARGET_APP_DIRS[target] || target;
      if (!fs.existsSync(path.join(brandRoot, 'apps', dir, 'package.json'))) {
        failures.push(`apps/${dir} missing for target ${target}`);
      }
    }
    const scaffoldedApps = fs.readdirSync(path.join(brandRoot, 'apps'));
    if (scaffoldedApps.length !== targets.length) {
      failures.push(`expected ${targets.length} apps, found ${scaffoldedApps.length} (${scaffoldedApps.join(', ')})`);
    }

    if (cell.instances) {
      failures.push(...await proveInstances(brandRoot, cell));
    } else if (targets.includes('web')) {
      if (cell.theme) flipTheme(brandRoot, cell.theme);
      if (cell.post) writePost(path.join(brandRoot, 'apps', 'website'));
      failures.push(...assertWebInvariants(cell, await buildWebApp(brandRoot)));
    }
  } catch (error) {
    failures.push(`crashed: ${error.message}`);
  }

  if (failures.length === 0) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  return { cell, failures, brandRoot };
}

async function main() {
  console.log(`\nBrand-shape corpus — ${CELLS.length} cells (offline: real onboard + real web builds, no installs)\n`);
  const outcomes = [];

  for (const [index, cell] of CELLS.entries()) {
    const outcome = await runCell(cell);
    outcomes.push(outcome);
    const label = `[${index + 1}/${CELLS.length}] ${cell.id}`;
    if (outcome.failures.length === 0) {
      console.log(`  ✓ ${label}`);
    } else {
      console.log(`  ✗ ${label}\n      ${outcome.failures.join('\n      ')}\n      kept: ${outcome.brandRoot}`);
    }
  }

  const failed = outcomes.filter((outcome) => outcome.failures.length > 0);
  console.log(failed.length === 0
    ? `\n  Shape corpus PASSED (${CELLS.length}/${CELLS.length})\n`
    : `\n  Shape corpus FAILED — ${failed.length}/${CELLS.length} cells\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\nShape corpus crashed: ${error.stack}\n`);
  process.exitCode = 1;
});

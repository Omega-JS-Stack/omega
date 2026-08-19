/**
 * `omega deploy --direct` plan tests — the pure repo/domain derivation
 * (shared @omega.js/config derivation from the repo.providers.github.repo
 * slug — name → brand.id, owner → repo.providers.github.org; cname from
 * brand.url's host). The build+push path is exercised
 * live against the playground via the manager's pipeline command, not here.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { after, test } = require('node:test');

const { buildDirectPlan, pagesHost } = require('../src/commands/deploy.js');

// Every plan here resolves from the CONFIG it is handed: an empty env and a
// working tree with no git remote keep the machine this runs on out of it.
const ISOLATED = { env: {}, cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'omega-no-repo-')) };

after(() => fs.rmSync(ISOLATED.cwd, { recursive: true, force: true }));

test('pagesHost: bare host from brand.url; empty when unset (feeds plan cname + build CNAME emission)', () => {
  assert.equal(pagesHost({ brand: { url: 'https://www.example.com/landing' } }), 'www.example.com');
  assert.equal(pagesHost({ brand: { url: 'http://omegajs.dev' } }), 'omegajs.dev');
  assert.equal(pagesHost({ brand: {} }), '');
  assert.equal(pagesHost({}), '');
});

// #366 — a project site's brand.url IS its Pages address (the #355 contract),
// and reading that as a custom domain would flip the whole plan: a CNAME
// claiming `<owner>.github.io`, the build mounted at `/` and every asset 404ing
// at the real address. A default-Pages host is never a custom domain.
test('pagesHost: a *.github.io brand.url is NEVER a custom domain (#366)', () => {
  assert.equal(pagesHost({ brand: { url: 'https://omega-js-stack.github.io/omega-brand/' } }), '');
  assert.equal(pagesHost({ brand: { url: 'https://omega-js-stack.github.io' } }), '', 'a bare Pages host is not one either');
  assert.equal(pagesHost({ brand: { url: 'http://OWNER.GitHub.io/Site' } }), '', 'host matching is case-insensitive');
  assert.equal(pagesHost({ brand: { url: 'https://github.io.example.com' } }), 'github.io.example.com', 'a real domain that merely CONTAINS github.io still is one');
});

test('direct plan: org + explicit repo + cname from brand.url host', () => {
  const plan = buildDirectPlan({
    repo: { providers: { github: { org: 'Org', repo: 'site' } } },
    brand: { id: 'b', url: 'https://www.example.com/landing' },
  });
  assert.equal(plan.repo, 'Org/site');
  assert.equal(plan.pushUrl, 'https://github.com/Org/site.git');
  assert.equal(plan.branch, 'gh-pages');
  assert.equal(plan.cname, 'www.example.com');
});

test('direct plan: bare-name slug names the repo (launch-night collision fix — never the monorepo)', () => {
  const plan = buildDirectPlan({
    repo: { providers: { github: { org: 'Omega-JS-Stack', repo: 'omega-brand' } } },
    brand: { id: 'omega', url: 'https://omegajs.dev' },
  });
  assert.equal(plan.repo, 'Omega-JS-Stack/omega-brand');
  assert.equal(plan.pushUrl, 'https://github.com/Omega-JS-Stack/omega-brand.git');
});

test('direct plan: owner/name slug carries both (ITW-housed brand repo, org still the brand org)', () => {
  const plan = buildDirectPlan({
    repo: { providers: { github: { org: 'Omega-JS-Stack', repo: 'itw-creative-works/omega-brand' } } },
    brand: { id: 'omega', url: 'https://omegajs.dev' },
  });
  assert.equal(plan.repo, 'itw-creative-works/omega-brand');
});

test('direct plan: repo defaults to brand.id when no slug is set', () => {
  const plan = buildDirectPlan({ repo: { providers: { github: { org: 'Org' } } }, brand: { id: 'my-brand', url: 'https://my.brand' } });
  assert.equal(plan.repo, 'Org/my-brand');
});

test('direct plan: a custom-domain plan carries the domain root prefix and its CNAME, unchanged', () => {
  const plan = buildDirectPlan({
    repo: { providers: { github: { org: 'Org', repo: 'site' } } },
    brand: { id: 'b', url: 'https://www.example.com' },
  }, ISOLATED);

  assert.equal(plan.cname, 'www.example.com');
  assert.equal(plan.url, 'https://www.example.com', 'the address the deploy reports');
  assert.equal(plan.pathPrefix, '/', 'a CNAME cannot carry a path — the build stays at the domain root');
});

test('direct plan: NO brand.url → a gh-pages PROJECT site (derived address, no CNAME, the #358 prefix)', () => {
  const plan = buildDirectPlan({
    repo: { providers: { github: { org: 'Omega-JS-Stack', repo: 'omega-brand' } } },
    brand: { id: 'omega' },
  }, ISOLATED);

  assert.equal(plan.repo, 'Omega-JS-Stack/omega-brand');
  assert.equal(plan.pushUrl, 'https://github.com/Omega-JS-Stack/omega-brand.git');
  assert.equal(plan.branch, 'gh-pages');
  assert.equal(plan.cname, '', 'no custom domain → no CNAME step');
  assert.equal(plan.url, 'https://omega-js-stack.github.io/omega-brand/', 'the default project address');
  assert.equal(plan.pathPrefix, '/omega-brand/', 'the build mounts everything under the project path');
});

// #366 — absolute URLs (canonical, og:url, hreflang alternates, sitemap) build
// from brand.url, so a project site that leaves it unset emits wrong or empty
// canonicals on every page. Nothing is derived at build time: the deploy names
// the exact value to set.
test('direct plan: a project site with no brand.url WARNS, printing the Pages URL to set (#366)', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts.join(' '));

  let plan;
  let quiet;
  try {
    plan = buildDirectPlan({
      repo: { providers: { github: { org: 'Omega-JS-Stack', repo: 'omega-brand' } } },
      brand: { id: 'omega' },
    }, ISOLATED);

    quiet = warnings.length;

    buildDirectPlan({
      repo: { providers: { github: { org: 'Org', repo: 'site' } } },
      brand: { id: 'b', url: 'https://www.example.com' },
    }, ISOLATED);
  } finally {
    console.warn = originalWarn;
  }

  const warning = warnings.find((line) => line.includes('brand.url'));
  assert.ok(warning, `the project-site plan warns about the unset brand.url: ${warnings.join(' | ')}`);
  // The no-trailing-slash form: what the docs write, and what composes with
  // `{{ site.url }}{{ page.url }}` without doubling the slash.
  assert.ok(warning.includes('"https://omega-js-stack.github.io/omega-brand"'), `the warning names the exact value to set: ${warning}`);
  assert.equal(plan.url, 'https://omega-js-stack.github.io/omega-brand/', 'the plan ADDRESS keeps its trailing slash — it is a directory, not a value to paste');
  assert.equal(warnings.length, quiet, 'a custom-domain plan has nothing to warn about');
});

// #366 — the advice has to be SAFE to follow: setting brand.url to the Pages
// address must leave the plan exactly as it was, or the warning would break the
// deploy it advises.
test('direct plan: taking the advice (brand.url = the Pages address) keeps the project-site plan intact (#366)', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts.join(' '));

  let plan;
  try {
    plan = buildDirectPlan({
      repo: { providers: { github: { org: 'Omega-JS-Stack', repo: 'omega-brand' } } },
      brand: { id: 'omega', url: 'https://omega-js-stack.github.io/omega-brand' },
    }, ISOLATED);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(plan.cname, '', 'still a project site — no CNAME claiming <owner>.github.io');
  assert.equal(plan.pathPrefix, '/omega-brand/', 'still mounted under the project path — assets keep resolving');
  assert.equal(plan.url, 'https://omega-js-stack.github.io/omega-brand/', 'the same address it published to before');
  assert.deepEqual(warnings, [], 'and the warning is spent — brand.url is set now');
});

test('direct plan: a *.github.io brand.url names the mount, the slug only fills the gaps (#366)', () => {
  const plan = buildDirectPlan({
    repo: { providers: { github: { org: 'Omega-JS-Stack', repo: 'omega-brand' } } },
    brand: { id: 'omega', url: 'https://omega-js-stack.github.io/workkit/' },
  }, ISOLATED);

  assert.equal(plan.repo, 'Omega-JS-Stack/omega-brand', 'the repo is still the slug’s');
  assert.equal(plan.pathPrefix, '/workkit/', 'the path brand.url carries IS the base path');
  assert.equal(plan.url, 'https://omega-js-stack.github.io/workkit/', 'and the address agrees with it');
});

test('direct plan: the repo slug falls back to GITHUB_REPOSITORY, then to the git origin remote (#361)', () => {
  const fromEnv = buildDirectPlan({ brand: { name: 'B' } }, { env: { GITHUB_REPOSITORY: 'Acme/site' }, cwd: ISOLATED.cwd });
  assert.equal(fromEnv.repo, 'Acme/site');
  assert.equal(fromEnv.url, 'https://acme.github.io/site/');
  assert.equal(fromEnv.pathPrefix, '/site/');

  const cloned = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-cloned-brand-'));
  execFileSync('git', ['init', '-q'], { cwd: cloned });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:Acme/cloned-brand.git'], { cwd: cloned });

  const fromRemote = buildDirectPlan({ brand: { name: 'B' } }, { env: {}, cwd: cloned });
  assert.equal(fromRemote.repo, 'Acme/cloned-brand', 'the clone names its own repo');
  assert.equal(fromRemote.url, 'https://acme.github.io/cloned-brand/');
  assert.equal(fromRemote.pathPrefix, '/cloned-brand/', 'plan address and build prefix agree — one derivation');

  fs.rmSync(cloned, { recursive: true, force: true });
});

test('the deploy path writes a CNAME only for the domain shape, and reports the plan address', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'deploy.js'), 'utf8');

  assert.match(source, /if \(plan\.cname\) \{\s*\n\s*fs\.writeFileSync\(path\.join\(dist, 'CNAME'\), plan\.cname\);/, 'the CNAME step is skipped for a project site');
  assert.match(source, /Deployed — \$\{plan\.url\} serves/, 'the deploy reports the address it published to');
});

// The OTHER CNAME writer: every production build emits dist/CNAME so both
// deploy lanes publish it. It asks the same one derivation, so a project site's
// brand.url can never make a build claim `<owner>.github.io` (#366).
test('the production build writes a CNAME only for a real custom domain — never *.github.io (#366)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'build.js'), 'utf8');

  assert.match(source, /const cname = require\('\.\/deploy\.js'\)\.pagesHost\(siteData\);\s*\n\s*if \(cname\) \{/, 'the build asks the ONE derivation whether a custom domain exists');
  assert.equal(pagesHost({ brand: { url: 'https://omega-js-stack.github.io/omega-brand' } }), '', 'so a project-site brand.url writes no CNAME at all');
});

test('direct plan: a repo that names itself NOWHERE refuses, naming every way out', () => {
  assert.throws(() => buildDirectPlan({ brand: { id: 'b', url: 'https://x.y' } }, ISOLATED), /repo\.providers\.github\.org/);
  assert.throws(() => buildDirectPlan({ repo: { providers: { github: { org: 'O' } } }, brand: { name: 'B' } }, ISOLATED), /repo\.providers\.github\.repo or brand\.id/);

  const message = (() => {
    try {
      buildDirectPlan({ brand: { name: 'B' } }, ISOLATED);
      return '';
    } catch (error) {
      return error.message;
    }
  })();
  assert.match(message, /GITHUB_REPOSITORY/, 'the CI environment is named as a way out');
  assert.match(message, /remote/, 'so is the git remote');
  assert.match(message, /CI dispatch/, 'and the other lane');
  // The throw is SLUG-only: setting brand.url resolves nothing here (the
  // custom-domain plan above throws with brand.url set), so it is not offered.
  assert.doesNotMatch(message, /brand\.url/, 'brand.url is never advertised as a way out of a missing slug');
});

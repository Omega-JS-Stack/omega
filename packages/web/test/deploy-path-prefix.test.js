/**
 * #358 — `omega deploy` AUTOFILLS the base path (#355's `OMEGA_PATH_PREFIX`),
 * so an ordinary gh-pages brand never sees an env var. The derivation reads
 * facts deploy already resolves:
 *
 *   brand.url set   → the site serves at that domain's root (the CNAME deploy
 *                     writes cannot carry a path) → `/`
 *   brand.url unset → the default project address
 *                     `https://<owner>.github.io/<name>/` → `/<name>/`, where
 *                     `<name>` is the WEBSITE repo the direct plan pushes to
 *                     (`<brand.id>-<target>`, #883).
 *
 * Both lanes fill it from the ONE derivation: the `--direct` lane sets it
 * around the build it runs itself, and CI runs that same lane. An explicitly
 * exported value always wins: publisher machinery (workkit's publish)
 * supplies its own, and normalization stays in src/path-prefix.js, never a
 * second copy.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { deployPathPrefix, targetPathPrefix } = require('../src/commands/deploy.js');
const { resolvePathPrefix } = require('../src/path-prefix.js');
const { scaffoldDefaults } = require('../src/scaffold.js');

const quiet = { log() {}, warn() {}, error() {} };

/** A target dir carrying a standalone omega.json5 (the real loader reads it). */
function tmpTarget(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-prefix-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), config);
  return dir;
}

// The website repo the prefix derives from is `<brand.id>-<target name>`, and
// the target name comes from the dir a deploy runs in: a standalone project's
// dir names nothing, so it reads the `web` its own scaffold declares.
const TARGETS = { targets: { web: { type: 'web' } } };
const STANDALONE = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-prefix-standalone-'));

test('brand.url set → the domain root: a CNAME cannot carry a path', () => {
  assert.equal(deployPathPrefix({ brand: { id: 'b', url: 'https://omegajs.dev' }, repo: { org: 'Org' }, ...TARGETS }, {}, STANDALONE), '/');
  assert.equal(deployPathPrefix({ brand: { id: 'b', url: 'http://www.example.com/landing' } }, {}, STANDALONE), '/');
});

test('brand.url unset → the Pages project address, named by the WEBSITE repo (#883)', () => {
  assert.equal(deployPathPrefix({ repo: { org: 'Org' }, brand: { id: 'b' }, ...TARGETS }, {}, STANDALONE), '/b-web/');
  assert.equal(deployPathPrefix({ repo: { org: 'Org' }, brand: { id: 'my-brand' }, ...TARGETS }, {}, STANDALONE), '/my-brand-web/', 'the same repo the direct plan pushes to');
  assert.equal(deployPathPrefix({ brand: { id: 'b' }, ...TARGETS }, {}, STANDALONE), '/', 'no org, no repo to name a path with: the #355 default');
});

// #366 — a *.github.io brand.url is the PROJECT ADDRESS, not a custom domain:
// the path it carries is the mount, so following the deploy's advice cannot
// move the build to the domain root.
test('a *.github.io brand.url names its own mount — the path it carries IS the base path (#366)', () => {
  assert.equal(deployPathPrefix({ brand: { url: 'https://owner.github.io/workkit' } }, {}, STANDALONE), '/workkit/');
  assert.equal(deployPathPrefix({ brand: { id: 'b', url: 'https://owner.github.io/workkit/' }, repo: { org: 'Org' }, ...TARGETS }, {}, STANDALONE), '/workkit/', 'the URL names the mount, not the repo');
  assert.equal(deployPathPrefix({ brand: { id: 'b', url: 'https://owner.github.io' }, repo: { org: 'Org' }, ...TARGETS }, {}, STANDALONE), '/b-web/', 'a bare Pages host names no project: the website repo does');
  assert.equal(deployPathPrefix({ brand: { url: 'https://owner.github.io/workkit' } }, { OMEGA_PATH_PREFIX: '/other' }, STANDALONE), '/other', 'an explicit export still wins');
});

// #883: GITHUB_REPOSITORY names the repo the RUN checked out (the source
// monorepo), never the website repo this site is published to, so it can no
// longer name the mount: a run that read it would mount the build under the
// source repo's name and 404 every asset.
test('GITHUB_REPOSITORY names the source repo, so it names nothing here (#883)', () => {
  assert.equal(deployPathPrefix({ brand: { id: 'b' }, ...TARGETS }, { GITHUB_REPOSITORY: 'Omega-JS-Stack/b-omega' }, STANDALONE), '/');
  assert.equal(deployPathPrefix({ repo: { org: 'Org' }, brand: { id: 'b' }, ...TARGETS }, { GITHUB_REPOSITORY: 'Omega-JS-Stack/b-omega' }, STANDALONE), '/b-web/', 'the website repo names it instead');
  assert.equal(deployPathPrefix({ ...TARGETS }, {}, STANDALONE), '/', 'nothing to derive → the domain root, the #355 default');
});

test('an explicitly exported OMEGA_PATH_PREFIX wins the autofill; a blank one is unset', () => {
  const project = { repo: { org: 'Org' }, brand: { id: 'b' }, ...TARGETS };
  assert.equal(deployPathPrefix(project, { OMEGA_PATH_PREFIX: '/workkit' }, STANDALONE), '/workkit', 'the publisher value wins');
  assert.equal(deployPathPrefix({ brand: { url: 'https://omegajs.dev' } }, { OMEGA_PATH_PREFIX: '/workkit' }, STANDALONE), '/workkit');
  assert.equal(deployPathPrefix(project, { OMEGA_PATH_PREFIX: '/' }, STANDALONE), '/', 'an explicit root is a value, not an absence');
  assert.equal(deployPathPrefix(project, { OMEGA_PATH_PREFIX: '   ' }, STANDALONE), '/b-web/', 'blank is unset: an empty Actions secret must not suppress the autofill');
  assert.equal(deployPathPrefix(project, {}, STANDALONE), '/b-web/');
});

test('the value normalizes through resolvePathPrefix — ONE normalizer (#355 owns it)', () => {
  assert.equal(deployPathPrefix({ repo: { org: 'Org' }, brand: { id: '  spaced  ' }, ...TARGETS }, {}, STANDALONE), '/spaced-web/');

  // What the build receives is what #355 normalizes: the two agree exactly.
  const derived = deployPathPrefix({ repo: { org: 'Org' }, brand: { id: 'site' }, ...TARGETS }, {}, STANDALONE);
  assert.equal(resolvePathPrefix(derived), '/site-web', 'the build mounts the site under /site-web');
  assert.equal(resolvePathPrefix(deployPathPrefix({ brand: { url: 'https://omegajs.dev' } }, {}, STANDALONE)), '', 'a domain-root deploy runs no prefix pass at all');
});

test('targetPathPrefix: the target-dir entry point loads the composed config (the CI lane calls this)', () => {
  const project = tmpTarget("{ brand: { id: 'acme', name: 'Acme' }, repo: { org: 'Acme-Org' }, targets: { web: { type: 'web' } } }\n");
  assert.equal(targetPathPrefix(project, {}), '/acme-web/', 'no brand.url → the project address of the website repo');
  fs.rmSync(project, { recursive: true, force: true });

  const domain = tmpTarget("{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: { type: 'web' } } }\n");
  assert.equal(targetPathPrefix(domain, {}), '/', 'brand.url → the domain root');
  assert.equal(targetPathPrefix(domain, { OMEGA_PATH_PREFIX: '/workkit' }), '/workkit', 'explicit still wins');
  fs.rmSync(domain, { recursive: true, force: true });
});

test('the --direct lane sets the variable around the build it runs itself', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'deploy.js'), 'utf8');
  // The plan carries the derived value (#361: the address it publishes to and
  // the path the build mounts under come from the one derivation)
  assert.match(source, /pathPrefix = deployPathPrefix\(config, env, cwd\)/, 'the plan derives it');
  assert.match(source, /OMEGA_PATH_PREFIX: plan\.pathPrefix/, 'the direct build env carries the plan value');
  assert.match(source, /npm run build -- --cached-only[\s\S]{0,120}env[,:} ]/, 'that env reaches the build exec');
});

test('the scaffolded CI workflow derives the same value before its build step', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-prefix-ci-'));
  scaffoldDefaults({ outputDir: root, logger: quiet });

  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8');
  assert.match(workflow, /require\('@omega\.js\/web\/deploy'\)\.targetPathPrefix\(\)/, 'CI calls the ONE derivation, not a copy of the rule');
  assert.match(workflow, /OMEGA_PATH_PREFIX=.*>> "\$GITHUB_ENV"/, 'the derived value becomes the job env for the build');
  assert.ok(
    workflow.indexOf('OMEGA_PATH_PREFIX') < workflow.indexOf('name: Build and deploy'),
    'derived BEFORE the build+deploy step that consumes it',
  );
  assert.ok(
    workflow.indexOf('sfw npm install') < workflow.indexOf('OMEGA_PATH_PREFIX'),
    'derived AFTER the install that puts @omega.js/web on disk',
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test('the package exports the deploy module CI requires by name', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.exports['./deploy'], './dist/commands/deploy.js', 'the workflow one-liner resolves in a published install');
});

// #426 — the CI lane calls this REMOTELY to decide where the build mounts, so
// a config with fatal findings must not quietly yield a base path: the run that
// consumed it would publish a site mounted from a config nothing reads. It fails
// where it is called, one step before the build refuses the same file.
test('targetPathPrefix: a fatal config finding is a refusal, never a base path (#426)', () => {
  const broken = tmpTarget("{ brand: { id: 'acme', name: 'Acme' }, payment: { processors: { stripe: {} } }, targets: { web: { type: 'web' } } }\n");

  assert.throws(
    () => targetPathPrefix(broken, {}),
    /config\/omega\.json5 is invalid:[\s\S]*payment\.processors is retired/,
  );
  assert.throws(
    () => targetPathPrefix(broken, { OMEGA_PATH_PREFIX: '/workkit' }),
    /payment\.processors is retired/,
    'an explicit prefix does not buy a broken config a pass — the build refuses it anyway',
  );

  fs.rmSync(broken, { recursive: true, force: true });
});

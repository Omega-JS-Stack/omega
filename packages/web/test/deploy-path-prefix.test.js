/**
 * #358 — `omega deploy` AUTOFILLS the base path (#355's `OMEGA_PATH_PREFIX`),
 * so an ordinary gh-pages brand never sees an env var. The derivation reads
 * facts deploy already resolves:
 *
 *   brand.url set   → the site serves at that domain's root (the CNAME deploy
 *                     writes cannot carry a path) → `/`
 *   brand.url unset → the default project address
 *                     `https://<owner>.github.io/<name>/` → `/<name>/`, from
 *                     the same config slug the direct plan resolves.
 *
 * Both lanes fill it from the ONE derivation: the `--direct` lane sets it
 * around the build it runs itself, and the CI-dispatch lane's scaffolded
 * workflow calls the same function remotely (`GITHUB_REPOSITORY` names the
 * repo when the checked-out config carries no slug). An explicitly exported
 * value always wins — publisher machinery (workkit's publish) supplies its
 * own — and normalization stays in src/path-prefix.js, never a second copy.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { deployPathPrefix, appPathPrefix } = require('../src/commands/deploy.js');
const { resolvePathPrefix } = require('../src/path-prefix.js');
const { scaffoldDefaults } = require('../src/scaffold.js');

const quiet = { log() {}, warn() {}, error() {} };

/** An app dir carrying a standalone omega.json5 (the real loader reads it). */
function tmpApp(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-prefix-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), config);
  return dir;
}

test('brand.url set → the domain root: a CNAME cannot carry a path', () => {
  assert.equal(deployPathPrefix({ brand: { id: 'b', url: 'https://omegajs.dev' }, repo: { providers: { github: { repo: 'Org/omega-brand' } } } }, {}), '/');
  assert.equal(deployPathPrefix({ brand: { id: 'b', url: 'http://www.example.com/landing' } }, {}), '/');
});

test('brand.url unset → the Pages project address /<name>/, from the slug the deploy plan resolves', () => {
  assert.equal(deployPathPrefix({ repo: { providers: { github: { org: 'Org', repo: 'site' } } }, brand: { id: 'b' } }, {}), '/site/');
  assert.equal(deployPathPrefix({ repo: { providers: { github: { repo: 'itw-creative-works/omega-brand' } } } }, {}), '/omega-brand/', 'the owner/name slug names the repo, not the owner');
  assert.equal(deployPathPrefix({ brand: { id: 'my-brand' } }, {}), '/my-brand/', 'brand.id is the slug fallback (same chain as the direct plan)');
});

// #366 — a *.github.io brand.url is the PROJECT ADDRESS, not a custom domain:
// the path it carries is the mount, so following the deploy's advice cannot
// move the build to the domain root.
test('a *.github.io brand.url names its own mount — the path it carries IS the base path (#366)', () => {
  assert.equal(deployPathPrefix({ brand: { url: 'https://owner.github.io/workkit' } }, {}), '/workkit/');
  assert.equal(deployPathPrefix({ brand: { url: 'https://owner.github.io/workkit/' }, repo: { providers: { github: { repo: 'Org/site' } } } }, {}), '/workkit/', 'the URL names the mount, not the slug');
  assert.equal(deployPathPrefix({ brand: { url: 'https://owner.github.io' }, repo: { providers: { github: { repo: 'Org/site' } } } }, {}), '/site/', 'a bare Pages host names no project — the slug does');
  assert.equal(deployPathPrefix({ brand: { url: 'https://owner.github.io/workkit' } }, { OMEGA_PATH_PREFIX: '/other' }), '/other', 'an explicit export still wins');
});

test('no config slug → GITHUB_REPOSITORY names the repo (the CI lane derives remotely)', () => {
  assert.equal(deployPathPrefix({}, { GITHUB_REPOSITORY: 'Omega-JS-Stack/omega-brand' }), '/omega-brand/');
  assert.equal(deployPathPrefix({ brand: { url: 'https://omegajs.dev' } }, { GITHUB_REPOSITORY: 'Omega-JS-Stack/omega-brand' }), '/', 'a custom domain still wins over the repo address');
  assert.equal(deployPathPrefix({}, {}), '/', 'nothing to derive → the domain root, the #355 default');
});

test('an explicitly exported OMEGA_PATH_PREFIX wins the autofill; a blank one is unset', () => {
  const project = { repo: { providers: { github: { repo: 'Org/site' } } } };
  assert.equal(deployPathPrefix(project, { OMEGA_PATH_PREFIX: '/workkit' }), '/workkit', 'the publisher value wins');
  assert.equal(deployPathPrefix({ brand: { url: 'https://omegajs.dev' } }, { OMEGA_PATH_PREFIX: '/workkit' }), '/workkit');
  assert.equal(deployPathPrefix(project, { OMEGA_PATH_PREFIX: '/' }), '/', 'an explicit root is a value, not an absence');
  assert.equal(deployPathPrefix(project, { OMEGA_PATH_PREFIX: '   ' }), '/site/', 'blank is unset — an empty Actions secret must not suppress the autofill');
  assert.equal(deployPathPrefix(project, {}), '/site/');
});

test('the value normalizes through resolvePathPrefix — ONE normalizer (#355 owns it)', () => {
  assert.equal(deployPathPrefix({ repo: { providers: { github: { repo: 'Org//My-Site//' } } } }, {}), '/My-Site/');
  assert.equal(deployPathPrefix({ brand: { id: '  spaced  ' } }, {}), '/spaced/');

  // What the build receives is what #355 normalizes: the two agree exactly.
  const derived = deployPathPrefix({ repo: { providers: { github: { repo: 'Org/site' } } } }, {});
  assert.equal(resolvePathPrefix(derived), '/site', 'the build mounts the site under /site');
  assert.equal(resolvePathPrefix(deployPathPrefix({ brand: { url: 'https://omegajs.dev' } }, {})), '', 'a domain-root deploy runs no prefix pass at all');
});

test('appPathPrefix: the app-dir entry point loads the composed config (the CI lane calls this)', () => {
  const project = tmpApp("{ brand: { id: 'acme', name: 'Acme' }, targets: { web: {} } }\n");
  assert.equal(appPathPrefix(project, {}), '/acme/', 'no brand.url → the project address');
  fs.rmSync(project, { recursive: true, force: true });

  const domain = tmpApp("{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");
  assert.equal(appPathPrefix(domain, {}), '/', 'brand.url → the domain root');
  assert.equal(appPathPrefix(domain, { OMEGA_PATH_PREFIX: '/workkit' }), '/workkit', 'explicit still wins');
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
  assert.match(workflow, /require\('@omega\.js\/web\/deploy'\)\.appPathPrefix\(\)/, 'CI calls the ONE derivation, not a copy of the rule');
  assert.match(workflow, /OMEGA_PATH_PREFIX=.*>> "\$GITHUB_ENV"/, 'the derived value becomes the job env for the build');
  assert.ok(
    workflow.indexOf('OMEGA_PATH_PREFIX') < workflow.indexOf('npx omega setup && npm run build'),
    'derived BEFORE the build that consumes it',
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

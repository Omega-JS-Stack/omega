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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'deploy-path-prefix',
  tests: [
    {
      name: 'brand.url set → the domain root: a CNAME cannot carry a path',
      run: (ctx) => {
        ctx.expect(deployPathPrefix({ brand: { id: 'b', url: 'https://omegajs.dev' }, repo: { owner: 'Org' }, ...TARGETS }, {}, STANDALONE)).toBe('/');
        ctx.expect(deployPathPrefix({ brand: { id: 'b', url: 'http://www.example.com/landing' } }, {}, STANDALONE)).toBe('/');
      },
    },

    {
      name: 'brand.url unset → the Pages project address, named by the WEBSITE repo (#883)',
      run: (ctx) => {
        ctx.expect(deployPathPrefix({ repo: { owner: 'Org' }, brand: { id: 'b' }, ...TARGETS }, {}, STANDALONE)).toBe('/b-web/');
        ctx.expect(deployPathPrefix({ repo: { owner: 'Org' }, brand: { id: 'my-brand' }, ...TARGETS }, {}, STANDALONE), 'the same repo the direct plan pushes to').toBe('/my-brand-web/');
        ctx.expect(deployPathPrefix({ brand: { id: 'b' }, ...TARGETS }, {}, STANDALONE), 'no owner, no repo to name a path with: the #355 default').toBe('/');
      },
    },

    // #366 — a *.github.io brand.url is the PROJECT ADDRESS, not a custom domain:
    // the path it carries is the mount, so following the deploy's advice cannot
    // move the build to the domain root.
    {
      name: 'a *.github.io brand.url names its own mount — the path it carries IS the base path (#366)',
      run: (ctx) => {
        ctx.expect(deployPathPrefix({ brand: { url: 'https://owner.github.io/workkit' } }, {}, STANDALONE)).toBe('/workkit/');
        ctx.expect(deployPathPrefix({ brand: { id: 'b', url: 'https://owner.github.io/workkit/' }, repo: { owner: 'Org' }, ...TARGETS }, {}, STANDALONE), 'the URL names the mount, not the repo').toBe('/workkit/');
        ctx.expect(deployPathPrefix({ brand: { id: 'b', url: 'https://owner.github.io' }, repo: { owner: 'Org' }, ...TARGETS }, {}, STANDALONE), 'a bare Pages host names no project: the website repo does').toBe('/b-web/');
        ctx.expect(deployPathPrefix({ brand: { url: 'https://owner.github.io/workkit' } }, { OMEGA_PATH_PREFIX: '/other' }, STANDALONE), 'an explicit export still wins').toBe('/other');
      },
    },

    // #883: GITHUB_REPOSITORY names the repo the RUN checked out (the source
    // monorepo), never the website repo this site is published to, so it can no
    // longer name the mount: a run that read it would mount the build under the
    // source repo's name and 404 every asset.
    {
      name: 'GITHUB_REPOSITORY names the source repo, so it names nothing here (#883)',
      run: (ctx) => {
        ctx.expect(deployPathPrefix({ brand: { id: 'b' }, ...TARGETS }, { GITHUB_REPOSITORY: 'Omega-JS-Stack/b-omega' }, STANDALONE)).toBe('/');
        ctx.expect(deployPathPrefix({ repo: { owner: 'Org' }, brand: { id: 'b' }, ...TARGETS }, { GITHUB_REPOSITORY: 'Omega-JS-Stack/b-omega' }, STANDALONE), 'the website repo names it instead').toBe('/b-web/');
        ctx.expect(deployPathPrefix({ ...TARGETS }, {}, STANDALONE), 'nothing to derive → the domain root, the #355 default').toBe('/');
      },
    },

    {
      name: 'an explicitly exported OMEGA_PATH_PREFIX wins the autofill; a blank one is unset',
      run: (ctx) => {
        const project = { repo: { owner: 'Org' }, brand: { id: 'b' }, ...TARGETS };
        ctx.expect(deployPathPrefix(project, { OMEGA_PATH_PREFIX: '/workkit' }, STANDALONE), 'the publisher value wins').toBe('/workkit');
        ctx.expect(deployPathPrefix({ brand: { url: 'https://omegajs.dev' } }, { OMEGA_PATH_PREFIX: '/workkit' }, STANDALONE)).toBe('/workkit');
        ctx.expect(deployPathPrefix(project, { OMEGA_PATH_PREFIX: '/' }, STANDALONE), 'an explicit root is a value, not an absence').toBe('/');
        ctx.expect(deployPathPrefix(project, { OMEGA_PATH_PREFIX: '   ' }, STANDALONE), 'blank is unset: an empty Actions secret must not suppress the autofill').toBe('/b-web/');
        ctx.expect(deployPathPrefix(project, {}, STANDALONE)).toBe('/b-web/');
      },
    },

    {
      name: 'the value normalizes through resolvePathPrefix — ONE normalizer (#355 owns it)',
      run: (ctx) => {
        ctx.expect(deployPathPrefix({ repo: { owner: 'Org' }, brand: { id: '  spaced  ' }, ...TARGETS }, {}, STANDALONE)).toBe('/spaced-web/');

        // What the build receives is what #355 normalizes: the two agree exactly.
        const derived = deployPathPrefix({ repo: { owner: 'Org' }, brand: { id: 'site' }, ...TARGETS }, {}, STANDALONE);
        ctx.expect(resolvePathPrefix(derived), 'the build mounts the site under /site-web').toBe('/site-web');
        ctx.expect(resolvePathPrefix(deployPathPrefix({ brand: { url: 'https://omegajs.dev' } }, {}, STANDALONE)), 'a domain-root deploy runs no prefix pass at all').toBe('');
      },
    },

    {
      name: 'targetPathPrefix: the target-dir entry point loads the composed config (the CI lane calls this)',
      run: (ctx) => {
        const project = tmpTarget("{ brand: { id: 'acme', name: 'Acme' }, repo: { owner: 'Acme-Org' }, targets: { web: { type: 'web' } } }\n");
        ctx.expect(targetPathPrefix(project, {}), 'no brand.url → the project address of the website repo').toBe('/acme-web/');
        fs.rmSync(project, { recursive: true, force: true });

        const domain = tmpTarget("{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: { type: 'web' } } }\n");
        ctx.expect(targetPathPrefix(domain, {}), 'brand.url → the domain root').toBe('/');
        ctx.expect(targetPathPrefix(domain, { OMEGA_PATH_PREFIX: '/workkit' }), 'explicit still wins').toBe('/workkit');
        fs.rmSync(domain, { recursive: true, force: true });
      },
    },

    {
      name: 'the --direct lane sets the variable around the build it runs itself',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'deploy.js'), 'utf8');
        // The plan carries the derived value (#361: the address it publishes to and
        // the path the build mounts under come from the one derivation)
        ctx.expect(source, 'the plan derives it').toMatch(/pathPrefix = deployPathPrefix\(config, env, cwd\)/);
        ctx.expect(source, 'the direct build env carries the plan value').toMatch(/OMEGA_PATH_PREFIX: plan\.pathPrefix/);
        ctx.expect(source, 'that env reaches the build exec').toMatch(/npm run build -- --cached-only[\s\S]{0,120}env[,:} ]/);
      },
    },

    {
      name: 'the scaffolded CI workflow derives the same value before its build step',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-prefix-ci-'));
        scaffoldDefaults({ outputDir: root, logger: quiet });

        const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8');
        ctx.expect(workflow, 'CI calls the ONE derivation, not a copy of the rule').toMatch(/require\('@omega\.js\/web\/deploy'\)\.targetPathPrefix\(\)/);
        ctx.expect(workflow, 'the derived value becomes the job env for the build').toMatch(/OMEGA_PATH_PREFIX=.*>> "\$GITHUB_ENV"/);
        ctx.expect(workflow.indexOf('OMEGA_PATH_PREFIX') < workflow.indexOf('name: Build and deploy'), 'derived BEFORE the build+deploy step that consumes it').toBeTruthy();
        ctx.expect(workflow.indexOf('sfw npm ci') !== -1 && workflow.indexOf('sfw npm ci') < workflow.indexOf('OMEGA_PATH_PREFIX'), 'derived AFTER the install that puts @omega.js/web on disk').toBeTruthy();

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'the package exports the deploy module CI requires by name',
      run: (ctx) => {
        const pkg = require('../package.json');
        ctx.expect(pkg.exports['./deploy'], 'the workflow one-liner resolves in a published install').toBe('./dist/commands/deploy.js');
      },
    },

    // #426 — the CI lane calls this REMOTELY to decide where the build mounts, so
    // a config with fatal findings must not quietly yield a base path: the run that
    // consumed it would publish a site mounted from a config nothing reads. It fails
    // where it is called, one step before the build refuses the same file.
    {
      name: 'targetPathPrefix: a fatal config finding is a refusal, never a base path (#426)',
      run: (ctx) => {
        const broken = tmpTarget("{ brand: { id: 'acme', name: 'Acme' }, payment: { processors: { stripe: {} } }, targets: { web: { type: 'web' } } }\n");

        ctx.expect(() => targetPathPrefix(broken, {})).toThrow(/config\/omega\.json5 is invalid:[\s\S]*payment\.processors\.stripe is not a key the schema declares/);
        ctx.expect(() => targetPathPrefix(broken, { OMEGA_PATH_PREFIX: '/workkit' }), 'an explicit prefix does not buy a broken config a pass — the build refuses it anyway').toThrow(/payment\.processors\.stripe is not a key the schema declares/);

        fs.rmSync(broken, { recursive: true, force: true });
      },
    },
  ],
});

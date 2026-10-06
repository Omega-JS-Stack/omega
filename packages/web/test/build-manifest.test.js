/**
 * The build manifest (#13): `writeBuildMeta` emits /build.json on every build.
 * It is what the /status page's "Build manifest" card reads, and what
 * @omega.js/client's version check polls, so every field the page shows is
 * pinned here: what the site is, what it is made of, what skin it wears, where
 * it lives, and which commit it came from.
 *
 * The service worker's CONFIG is not here (#743): it loads the one `/build.js`
 * the engine writes, the same snapshot every page loads.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { setEnvironment } = require('@omega.js/config/environment');
const { writeBuildMeta } = require('../src/service-worker.js');

const PKG = path.resolve(__dirname, '..');
const CLIENT_ENTRY = path.join(PKG, '..', 'client', 'src', 'index.js');

const SITE_DATA = {
  brand: { id: 'contract', name: 'Contract' },
  theme: { id: 'newsflash' },
  repo: { provider: 'github', owner: 'Omega-JS-Stack' },
  cloud: { config: { projectId: 'demo-contract' } },
};

/** Build the meta into a throwaway dir and read the emitted /build.json back. */
function emit(overrides = {}) {
  // The lane NAMES the environment (#817), and the manifest records that one
  // answer rather than a loose option of its own: `omega build` is production.
  setEnvironment(overrides.environment || 'production');

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-build-meta-'));
  const returned = writeBuildMeta({
    siteData: SITE_DATA,
    outDir,
    version: '2.4.0',
    clientEntry: CLIENT_ENTRY,
    consumerDir: PKG,
    manifest: { js: { main: '/assets/js/main-A.js' }, css: { main: '/assets/css/main-b.css' } },
    ...overrides,
  });

  return { returned, outDir, json: JSON.parse(fs.readFileSync(path.join(outDir, 'build.json'), 'utf8')) };
}

module.exports = defineCases({
  type: 'group',
  description: 'build-manifest',
  tests: [
    {
      name: 'the manifest carries the whole build story, and /build.json IS what it returned',
      run: (ctx) => {
        const { returned, json } = emit();

        ctx.expect(json, 'the page reads exactly what the builder computed').toEqual(returned);
        ctx.expect(json.brand).toBe('contract');
        ctx.expect(json.name).toBe('Contract');
        ctx.expect(json.environment).toBe('production');
        ctx.expect(json.version).toBe('2.4.0');
        ctx.expect(json.theme, 'which skin the site was built in').toBe('newsflash');
        ctx.expect(json.assets).toEqual({ js: '/assets/js/main-A.js', css: '/assets/css/main-b.css' });
        ctx.expect(json.firebase).toEqual({ projectId: 'demo-contract' });
        ctx.expect(json.timestamp, 'the key the client version check reads').toMatch(/^\d{4}-\d{2}-\d{2}T/);
        ctx.expect(json.buildTime).toBe(json.timestamp);
        ctx.expect(typeof json.cacheBreaker).toBe('number');
      },
    },

    {
      name: 'packages: the frameworks the site is actually made of, read from their manifests',
      run: (ctx) => {
        const { json } = emit();
        const web = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
        const client = JSON.parse(fs.readFileSync(path.join(PKG, '..', 'client', 'package.json'), 'utf8'));

        ctx.expect(json.packages['@omega.js/web'], 'the framework reports its OWN version, never a hardcoded one').toBe(web.version);
        ctx.expect(json.packages['@omega.js/client']).toBe(client.version);
        ctx.expect(json.packages.firebase, 'the firebase the SW and the page agree on').toMatch(/^\d+\.\d+\.\d+/);
        ctx.expect(json.packages.node, 'which node built it').toBe(process.version.replace(/^v/, ''));
      },
    },

    {
      name: 'packages: an unresolvable client still leaves a usable manifest',
      run: (ctx) => {
        const { json } = emit({ clientEntry: path.join(os.tmpdir(), 'nowhere', 'index.js') });

        ctx.expect(json.packages['@omega.js/client'], 'nothing invented for a package that is not there').toBe(undefined);
        ctx.expect(json.packages.firebase, 'the pinned fallback keeps page and worker in step').toMatch(/^\d+\.\d+\.\d+/);
      },
    },

    // #883: the manifest links where the site is AUTHORED, so it names the
    // SOURCE monorepo (`<brand.id>-omega`), never the website repo the built site
    // is pushed to. Both derive from the one `repo.owner`.
    {
      name: 'repo: the SOURCE repo, derived through @omega.js/config (#883)',
      run: (ctx) => {
        ctx.expect(emit().json.repo, 'owner from repo.owner, name derived as `<brand.id>-omega`').toEqual({ user: 'Omega-JS-Stack', name: 'contract-omega' });
        ctx.expect(emit({ siteData: { brand: { id: 'contract' } } }).json.repo, 'no owner, no repo link: never half a URL').toBe(null);
        ctx.expect(emit({ siteData: { repo: { owner: 'Omega-JS-Stack' } } }).json.repo, 'and no brand.id is half an address too').toBe(null);
      },
    },

    {
      name: 'commit: the sha when the consumer is a repo, null when it is not',
      run: (ctx) => {
        const expected = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: PKG, encoding: 'utf8' }).trim();
        ctx.expect(emit().json.commit, 'the commit the site was built from').toBe(expected);

        // A tarball install, a CI checkout with no .git, a brand that never ran
        // `git init` — all EXPECTED, so the manifest says null and the build lives.
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-no-git-'));
        ctx.expect(emit({ consumerDir: bare }).json.commit).toBe(null);
        ctx.expect(emit({ consumerDir: undefined }).json.commit).toBe(null);
      },
    },

    {
      name: 'the manifest is the ONLY file this writes: /build.js belongs to the engine (#743)',
      run: (ctx) => {
        const { outDir } = emit();

        // One snapshot, one writer. This used to emit a second `self.OMEGA_BUILD_JSON`
        // file of its own for the service worker, carrying a DIFFERENT shape from the
        // one every page read.
        ctx.expect(fs.readdirSync(outDir)).toEqual(['build.json']);
      },
    },

    {
      name: 'the status page reads every manifest field the builder emits',
      run: (ctx) => {
        const page = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'status', 'index.js'), 'utf8');
        const layout = fs.readFileSync(path.join(PKG, 'themes', 'base', '_layouts', 'frontend', 'pages', 'status.html'), 'utf8');

        for (const [field, slot] of [
          ['timestamp', 'build-time'],
          ['environment', 'build-environment'],
          ['version', 'build-version'],
          ['theme', 'build-theme'],
          ['packages', 'build-packages'],
          ['repo', 'build-repo'],
          ['commit', 'build-commit'],
        ]) {
          ctx.expect(page, `the page JS reads ${field}`).toMatch(new RegExp(`data\\.${field}\\b`));
          ctx.expect(page, `the page JS names the #${slot} slot`).toMatch(new RegExp(`'#${slot}'`));
          ctx.expect(layout.includes(`id="${slot}"`), `the layout carries the #${slot} slot`).toBeTruthy();
        }
      },
    },
  ],
});

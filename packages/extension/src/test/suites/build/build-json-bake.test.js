// The OMEGA_BUILD_JSON bake, bundle lane
// ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)).
//
// The snapshot an extension context reads is composed here and written ONCE, as
// `dist/build.js`: the page template loads it with a script tag, background.js
// with importScripts, and package.js copies it into every packaged raw dir. It
// rode in every emitted bundle as an esbuild `define` plus a `banner` for a
// while, one config copied into 21 files; what this suite pins is the one file,
// the bundles carrying no copy of their own, and the facts inside it.
//
// The composition cases moved here from package-task.test.js with the code:
// `cloud` reaching the snapshot is what the SW's Firebase auth lives or dies by
// (#46), the license stamp rides outside `config` (#320), and the dev port map
// is the ONLY channel a browser context has to a bumped emulator (#300, #262).
//
// The task module reads its project (package.json / config / dist) from cwd at
// REQUIRE time, so each test stages a temp project, chdirs into it, and requires
// the task fresh — the same model as package-task.test.js's inProject().

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const vm   = require('vm');
const defineCases = require('@omega.js/devkit/test/define-cases');

const SRC       = path.join(__dirname, '..', '..', '..');
const TASK_PATH = path.join(SRC, 'gulp', 'tasks', 'bundle.js');
const { readBakedBuildJson } = require(path.join(SRC, 'gulp', 'tasks', 'utils', 'build-json.js'));

// The boot lane loads the in-tree fixture consumer, which stands in for a real
// built extension — so it carries a checked-in copy of the banner.
const FIXTURE = path.join(SRC, 'test', 'fixtures', 'consumer-extension', 'dist');

// Stage a temp extension project. `files` is a relative-path → contents map
// written verbatim (the entry points the bundle task discovers, …).
function stageProject(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-build-json-'));

  fs.writeFileSync(path.join(tmp, 'package.json'), opts.pkg ?? `{ "name": "staged-ext", "version": "3.1.4" }`);

  if (opts.config !== undefined) {
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), opts.config);
  }

  for (const [relative, contents] of Object.entries(opts.files || {})) {
    const full = path.join(tmp, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  return tmp;
}

// Run `fn(task)` with cwd pinned to `dir` and the task module loaded fresh.
async function inProject(dir, fn) {
  const oldCwd = process.cwd();
  const flush = () => {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(SRC + path.sep)) delete require.cache[key];
    }
  };

  flush();
  try {
    process.chdir(dir);
    return await fn(require(TASK_PATH));
  } finally {
    process.chdir(oldCwd);
    flush();
  }
}

// An entry that reads the snapshot the way every extension context reads it:
// off the globals `/build.js` assigned (`self` is what background.js reads,
// `window`/`globalThis` what every page context reads). Guarded, so the same
// bundle can be run with NO build.js loaded first: that run is what proves the
// bundle carries no copy of its own any more.
const PROBE_ENTRY = [
  'try { globalThis.__fromGlobal = globalThis.OMEGA_BUILD_JSON.config.brand.id; } catch (e) { globalThis.__fromGlobal = null; }',
  'try { globalThis.__fromSelf = self.OMEGA_BUILD_JSON.config.brand.id; } catch (e) { globalThis.__fromSelf = null; }',
  '',
].join('\n');

// Run an emitted bundle the way a browser would (it is a self-contained iife
// with no imports and no chrome APIs) and hand back what it set.
//
// `loader` is the build.js the context loaded first, exactly as a page's script
// tag or the worker's importScripts does; without it the scope has no snapshot
// at all, which is what a bundle that still carried its own copy would hide.
function runBundleFile(file, options = {}) {
  const scope = {};
  scope.self = scope;
  if (options.loader) vm.runInNewContext(fs.readFileSync(options.loader, 'utf8'), scope);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), scope);
  return scope;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'OMEGA_BUILD_JSON bake — composed once, carried by every emitted bundle (#743)',
  timeout: 120000,
  tests: [
    {
      name: 'the build writes ONE dist/build.js, and the bundles carry no copy (#743)',
      run: async (ctx) => {
        const tmp = stageProject({
          config: `{
            brand: { id: 'staged', name: 'Staged' },
            targets: { extension: { type: 'extension' } },
          }`,
          files: {
            // The service worker's entry and a page entry — the two contexts the
            // JSONP file used to reach by two different mechanisms.
            'src/assets/js/components/background/index.js': PROBE_ENTRY,
            'src/assets/js/components/popup/index.js': PROBE_ENTRY,
          },
        });
        try {
          await inProject(tmp, async (task) => {
            const failure = await new Promise((resolve) => task.bundleTask(resolve));
            ctx.expect(failure).toBe(undefined);

            // ONE file, at the root a page's `/build.js` and the worker's
            // importScripts both resolve against.
            const loader = path.join(tmp, 'dist', 'build.js');
            ctx.expect(fs.existsSync(loader)).toBe(true);
            ctx.expect(readBakedBuildJson(loader).config.brand.id).toBe('staged');

            for (const name of ['background', 'popup']) {
              const emitted = path.join(tmp, 'dist', 'assets', 'js', 'components', `${name}.bundle.js`);
              ctx.expect(fs.existsSync(emitted)).toBe(true);

              // Loaded the way the artifact loads it: build.js first, then the
              // bundle. `self` and `globalThis` both answer, the two names the
              // service worker and every page context read.
              const ran = runBundleFile(emitted, { loader });
              ctx.expect(ran.__fromGlobal).toBe('staged');
              ctx.expect(ran.__fromSelf).toBe('staged');

              // With no build.js loaded, the bundle has nothing: no banner, no
              // define, no second copy of the config in the file a store reads.
              const alone = runBundleFile(emitted);
              ctx.expect(alone.__fromGlobal).toBe(null);
              ctx.expect(alone.__fromSelf).toBe(null);
              ctx.expect(fs.readFileSync(emitted, 'utf8').includes('OMEGA_BUILD_JSON = {')).toBe(false);
            }
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      // The boot lane is what proves a BROWSER resolves the snapshot, and it
      // runs against the checked-in fixture rather than a build. That only means
      // anything while the fixture is shaped like a real artifact: one build.js
      // at its root, the worker loading it with importScripts and the page with
      // a script tag, and neither bundle carrying a copy of its own.
      name: 'the boot fixture is a real artifact: one build.js, loaded by both contexts (#743)',
      run: async (ctx) => {
        const loader = path.join(FIXTURE, 'build.js');
        const source = fs.readFileSync(loader, 'utf8');

        // The same two statements devkit writes (@omega.js/devkit/build-json)
        ctx.expect(source.startsWith('self.OMEGA_BUILD_JSON = {')).toBe(true);
        ctx.expect(source.includes('\nself.OMEGA_BUILD_JSON.config.dev = ')).toBe(true);
        ctx.expect(readBakedBuildJson(loader).config.brand.id).toBe('bxm-fixture');

        // The worker's first line, and the page's first script
        ctx.expect(fs.readFileSync(path.join(FIXTURE, 'background.js'), 'utf8').split('\n', 1)[0])
          .toBe("importScripts('/build.js');");
        const popup = fs.readFileSync(path.join(FIXTURE, 'popup.html'), 'utf8');
        ctx.expect(popup.indexOf('src="/build.js"') < popup.indexOf('src="popup.bundle.js"')).toBe(true);

        for (const file of ['background.js', 'popup.bundle.js']) {
          ctx.expect(fs.readFileSync(path.join(FIXTURE, file), 'utf8').includes('OMEGA_BUILD_JSON = {')).toBe(false);
        }
      },
    },
    {
      name: 'the snapshot carries cloud from config/omega.json5 (#46)',
      run: async (ctx) => {
        const tmp = stageProject({
          config: `{
            brand: { id: 'staged', name: 'Staged' },
            cloud: { config: { apiKey: 'AIza-staged', projectId: 'demo-staged', appId: '1:2:web:3' } },
            targets: { extension: { type: 'extension' } },
          }`,
        });
        try {
          await inProject(tmp, async (task) => {
            const buildJson = await task.composeBuildJson();

            ctx.expect(buildJson.config.cloud.config.apiKey).toBe('AIza-staged');
            ctx.expect(buildJson.config.cloud.config.projectId).toBe('demo-staged');
            // Without it the service worker's Firebase auth never initializes.
            // `cloud.config` is the CANONICAL home @omega.js/client boots from,
            // so the bake no longer mirrors it into a `firebase` blob (#894).
            ctx.expect(buildJson.config.firebase).toBeUndefined();
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the snapshot records the build\'s license verdict, outside the client config (#320)',
      run: async (ctx) => {
        const tmp = stageProject({
          config: `{ brand: { id: 'staged', name: 'Staged' }, targets: { extension: { type: 'extension' } } }`,
        });
        try {
          await inProject(tmp, async (task) => {
            const buildJson = await task.composeBuildJson();

            // A test run is not a production build, so it never phones home:
            // keyless is what an unlicensed artifact records (spec call 5).
            ctx.expect(buildJson.license).toEqual({ status: 'keyless', payments: 'gated', attribution: 'shown' });
            // A fact about the BUILD — the client contract is untouched.
            ctx.expect(buildJson.config.license).toBeUndefined();
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a brand that declares no cloud bakes no cloud at all',
      run: async (ctx) => {
        const tmp = stageProject({});
        try {
          await inProject(tmp, async (task) => {
            const buildJson = await task.composeBuildJson();
            // An absent section is absent, never an empty blob the client has
            // to tell apart from a real one (#894).
            ctx.expect(buildJson.config.cloud).toBeUndefined();
            ctx.expect(buildJson.config.firebase).toBeUndefined();
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    // #894: the wrapper and the subset are the SAME on every browser surface.
    // The hand-written allow list this replaced is what made the extension's
    // snapshot a third shape: a value went public here, in web's engine and in
    // desktop's bundle task, three times, and every one of them could be the
    // place it leaked.
    {
      name: 'the wrapper is { config, package, mode, license, builtAt }, desktop\'s shape (#894)',
      run: async (ctx) => {
        const tmp = stageProject({
          config: `{ brand: { id: 'staged', name: 'Staged' }, targets: { extension: { type: 'extension' } } }`,
        });
        try {
          await inProject(tmp, async (task) => {
            const buildJson = await task.composeBuildJson();

            ctx.expect(Object.keys(buildJson).sort()).toEqual(['builtAt', 'config', 'license', 'mode', 'package']);
            ctx.expect(buildJson.package.name).toBe('staged-ext');
            ctx.expect(buildJson.package.version).toBe('3.1.4');
            ctx.expect(buildJson.mode.environment).toBe('testing');
            ctx.expect(typeof buildJson.builtAt).toBe('string');
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the snapshot carries the client sections and NO credential section (#894)',
      run: async (ctx) => {
        const tmp = stageProject({
          config: `{
            brand: { id: 'staged', name: 'Staged' },
            theme: { id: 'classy' },
            analytics: { providers: { google: { id: 'G-STAGED' } } },
            cloud: { config: { apiKey: 'AIza-staged' }, billingAccount: '01ABCD-234567-89EFGH' },
            certificates: { providers: { apple: { teamId: 'TEAM' } } },
            account: { admins: [{ email: 'root@staged.com' }] },
            repo: { provider: 'github', org: 'Staged-Org' },
            targets: { extension: { type: 'extension', listings: { chrome: { id: 'abcdefghijklmnopqrstuvwxyzabcdef' } } } },
          }`,
        });
        try {
          await inProject(tmp, async (task) => {
            const config = (await task.composeBuildJson()).config;

            ctx.expect(config.brand.id).toBe('staged');
            ctx.expect(config.theme.id).toBe('classy');
            ctx.expect(config.analytics.providers.google.id).toBe('G-STAGED');
            ctx.expect(config.listings.chrome.id).toBe('abcdefghijklmnopqrstuvwxyzabcdef');
            // The build facts every surface spells the same way
            ctx.expect(config.runtime).toBe('browser-extension');
            ctx.expect(config.version).toBe('3.1.4');
            ctx.expect(typeof config.buildTime).toBe('number');
            // The live-reload port rides the local stack's own map (#896)
            ctx.expect(config.dev.liveReloadPort).toBeGreaterThan(0);
            ctx.expect(config.omega).toBeUndefined();

            // A store artifact is public: nothing that provisions the brand
            // rides in it.
            ctx.expect(config.certificates).toBeUndefined();
            ctx.expect(config.account).toBeUndefined();
            ctx.expect(config.repo).toBeUndefined();
            ctx.expect(config.cloud.billingAccount).toBeUndefined();
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the Measurement Protocol secret is baked AFTER the subset gate, the one sanctioned .env value (#626)',
      run: async (ctx) => {
        const tmp = stageProject({
          config: `{
            brand: { id: 'staged', name: 'Staged' },
            analytics: { providers: { google: { id: 'G-STAGED' } } },
            targets: { extension: { type: 'extension' } },
          }`,
        });
        const previous = process.env.GOOGLE_ANALYTICS_SECRET;
        process.env.GOOGLE_ANALYTICS_SECRET = 'mp-secret';
        try {
          await inProject(tmp, async (task) => {
            const config = (await task.composeBuildJson()).config;

            // publicAtRest (docs/shared/config.md): the SW sends Measurement
            // Protocol events itself, so this one value is sanctioned into the
            // artifact. It never travels through clientConfig, which refuses
            // secret-shaped keys outright.
            ctx.expect(config.analytics.providers.google.id).toBe('G-STAGED');
            ctx.expect(config.analytics.providers.google.secret).toBe('mp-secret');
          });
        } finally {
          if (previous === undefined) delete process.env.GOOGLE_ANALYTICS_SECRET;
          else process.env.GOOGLE_ANALYTICS_SECRET = previous;
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the bake carries the sibling backend\'s resolved emulator ports, and never in production (#300)',
      run: async (ctx) => {
        // An extension context has no env and no filesystem — the bake is its
        // ONLY channel to a bumped emulator. Stage the target inside a real brand
        // with a live backend ports file beside it.
        const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-dev-ports-brand-'));
        fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
        fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), `{ brand: { id: 'staged', name: 'Staged' } }`);
        fs.mkdirSync(path.join(brand, 'targets', 'backend', '.temp'), { recursive: true });
        fs.writeFileSync(path.join(brand, 'targets', 'backend', '.temp', 'ports.json'), JSON.stringify({
          ports: { auth: 9100, firestore: 8081, hosting: 5003 }, pid: process.pid, startedAt: 'x',
        }));

        // …and a live WEBSITE publishing its resolved origin beside its port —
        // bumped AND https, the pair a port number alone can never express (#262)
        fs.mkdirSync(path.join(brand, 'targets', 'web', '.temp'), { recursive: true });
        fs.writeFileSync(path.join(brand, 'targets', 'web', '.temp', 'ports.json'), JSON.stringify({
          ports: { website: 4001 }, origin: 'https://localhost:4001', pid: process.pid, startedAt: 'x',
        }));

        const app = path.join(brand, 'targets', 'extension');
        fs.mkdirSync(app, { recursive: true });
        fs.writeFileSync(path.join(app, 'package.json'), `{ "name": "staged-ext", "version": "3.1.4" }`);

        // OMEGA_ENVIRONMENT is the ONE environment input
        // ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)) and
        // src/build.js WRITES it at load from the lane, so a helper that
        // simulates a second lane in one process must clear and restore it or
        // the first lane's word outlives the case (and the next suite's).
        // OMEGA_LICENSE_KEY rides the list because a production bake runs the
        // license check (#320): the suite stays offline on a machine that has
        // a real key exported.
        const ENV_KEYS = ['OMEGA_ENVIRONMENT', 'OMEGA_BUILD_MODE', 'OMEGA_TEST_MODE', 'NODE_ENV', 'OMEGA_LICENSE_KEY'];
        const bake = async (mode) => {
          const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
          ENV_KEYS.forEach((key) => delete process.env[key]);
          if (mode === 'production') process.env.OMEGA_BUILD_MODE = 'true';
          try {
            return await inProject(app, async (task) => (await task.composeBuildJson()).config);
          } finally {
            ENV_KEYS.forEach((key) => {
              if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
            });
          }
        };

        try {
          const dev = await bake('development');
          ctx.expect(dev.dev.ports.auth).toBe(9100);
          ctx.expect(dev.dev.ports.firestore).toBe(8081);
          ctx.expect(dev.dev.ports.hosting).toBe(5003);
          // The website's origin is a resolved fact in the same map (#262)
          ctx.expect(dev.dev.origin).toBe('https://localhost:4001');

          // A packaged build has no local stack to reach — no map ships
          const production = await bake('production');
          ctx.expect(production.dev).toBe(undefined);
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
  ],
});

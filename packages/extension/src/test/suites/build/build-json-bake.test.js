// The OMEGA_BUILD_JSON bake, bundle lane
// ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)).
//
// The snapshot an extension context reads is composed here and BAKED into every
// emitted bundle two ways — `define` replaces the bare identifier at compile
// time, `banner` prepends the globalThis/self/window assignment — which is the
// shape @omega.js/desktop has always used. It used to be a
// `packaged/<target>/raw/build.js` JSONP file the service worker
// importScripts()'d and every page loaded with its own <script> tag, plus a
// `build.json` sidecar nothing read; both files are gone, so what this suite
// pins is that the artifact still carries the same facts.
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

// An entry that reads the snapshot BOTH ways the bake delivers it: the bare
// identifier the `define` replaces at compile time, and the globals the `banner`
// assigns at load time (`self` is what background.js reads, `window`/`globalThis`
// what every page context reads). The global reads are guarded so the body can
// also be run on its OWN, with no banner in scope — that run is what tells the
// two mechanisms apart.
const PROBE_ENTRY = [
  'globalThis.__fromDefine = OMEGA_BUILD_JSON.config.brand.id;',
  'try { globalThis.__fromGlobal = globalThis.OMEGA_BUILD_JSON.config.brand.id; } catch (e) { globalThis.__fromGlobal = null; }',
  'try { globalThis.__fromSelf = self.OMEGA_BUILD_JSON.config.brand.id; } catch (e) { globalThis.__fromSelf = null; }',
  '',
].join('\n');

// Run an emitted bundle the way a browser would — it is a self-contained iife
// with no imports and no chrome APIs — and hand back what it set.
//
// `banner: false` runs everything BUT the first line, in a scope where nothing
// has assigned OMEGA_BUILD_JSON. Only the compile-time `define` can answer there,
// so this is what proves the define is doing work rather than the banner's global
// quietly covering for it.
function runBundleFile(file, options = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const scope = {};
  scope.self = scope;
  vm.runInNewContext(options.banner === false ? source.slice(source.indexOf('\n') + 1) : source, scope);
  return scope;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'OMEGA_BUILD_JSON bake — composed once, carried by every emitted bundle (#743)',
  timeout: 120000,
  tests: [
    {
      name: 'every emitted bundle carries the snapshot as a define AND as the global (#743)',
      run: async (ctx) => {
        const tmp = stageProject({
          config: `{
            brand: { id: 'staged', name: 'Staged' },
            targets: { extension: {} },
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

            for (const name of ['background', 'popup']) {
              const emitted = path.join(tmp, 'dist', 'assets', 'js', 'components', `${name}.bundle.js`);
              ctx.expect(fs.existsSync(emitted)).toBe(true);

              // The banner IS the first line — it has to land ahead of the
              // bundle's own code, which is the load order the SW's
              // importScripts('/build.js') used to buy.
              ctx.expect(readBakedBuildJson(emitted).config.brand.id).toBe('staged');

              // banner: globalThis and self both answer, the two names the
              // page contexts and the service worker read (#743)
              const ran = runBundleFile(emitted);
              ctx.expect(ran.__fromGlobal).toBe('staged');
              ctx.expect(ran.__fromSelf).toBe('staged');

              // define: the bare identifier became the literal at compile time —
              // it still answers with the banner line withheld, where nothing
              // has assigned the global at all.
              const bare = runBundleFile(emitted, { banner: false });
              ctx.expect(bare.__fromDefine).toBe('staged');
              ctx.expect(bare.__fromGlobal).toBe(null);
              ctx.expect(bare.__fromSelf).toBe(null);
            }
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      // The boot lane is what proves a BROWSER resolves the bake, and it runs
      // against the checked-in fixture rather than a build. That only means
      // anything while the fixture carries the banner this generator emits — so
      // the shape (the IIFE, the three scopes it assigns) is pinned here against
      // the live function. Change buildJsonBanner and this fails until the
      // fixture is regenerated.
      name: 'the boot fixture carries the banner buildJsonBanner emits, per bundle (#743)',
      run: async (ctx) => {
        const task = require(TASK_PATH);

        for (const file of ['background.js', 'popup.bundle.js']) {
          const full = path.join(FIXTURE, file);
          const firstLine = fs.readFileSync(full, 'utf8').split('\n', 1)[0];

          ctx.expect(firstLine).toBe(task.buildJsonBanner(readBakedBuildJson(full)).js);
          // Every bundle carries its OWN copy — that is what replaced the single file.
          ctx.expect(readBakedBuildJson(full).config.brand.id).toBe('bxm-fixture');
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
            targets: { extension: {} },
          }`,
        });
        try {
          await inProject(tmp, async (task) => {
            const buildJson = await task.composeBuildJson();

            ctx.expect(buildJson.config.cloud.config.apiKey).toBe('AIza-staged');
            ctx.expect(buildJson.config.cloud.config.projectId).toBe('demo-staged');
            // Without it the service worker's Firebase auth never initializes
            ctx.expect(buildJson.config.firebase.app.enabled).toBe(true);
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
          config: `{ brand: { id: 'staged', name: 'Staged' }, targets: { extension: {} } }`,
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
      name: 'cloud is an empty object when config/omega.json5 declares none',
      run: async (ctx) => {
        const tmp = stageProject({});
        try {
          await inProject(tmp, async (task) => {
            const buildJson = await task.composeBuildJson();
            ctx.expect(buildJson.config.cloud).toEqual({});
            ctx.expect(buildJson.config.firebase.app.enabled).toBe(false);
          });
        } finally {
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
        fs.mkdirSync(path.join(brand, 'targets', 'website', '.temp'), { recursive: true });
        fs.writeFileSync(path.join(brand, 'targets', 'website', '.temp', 'ports.json'), JSON.stringify({
          ports: { website: 4001 }, origin: 'https://localhost:4001', pid: process.pid, startedAt: 'x',
        }));

        const app = path.join(brand, 'targets', 'extension');
        fs.mkdirSync(app, { recursive: true });
        fs.writeFileSync(path.join(app, 'package.json'), `{ "name": "staged-ext", "version": "3.1.4" }`);

        // The runner itself exports OMEGA_TEST_MODE, and getEnvironment() reads
        // it BEFORE OMEGA_BUILD_MODE — a "production" bake under omega test is
        // otherwise a testing bake (the auth-emulator-gate bakeConfig idiom).
        // OMEGA_LICENSE_KEY rides the list because a production bake runs the
        // license check (#320): the suite stays offline on a machine that has
        // a real key exported.
        const ENV_KEYS = ['OMEGA_BUILD_MODE', 'OMEGA_TEST_MODE', 'NODE_ENV', 'OMEGA_LICENSE_KEY'];
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

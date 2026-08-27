// Build-layer tests for gulp/tasks/package.js — the three things a consumer's
// packaged output lives or dies by (#46):
//
//   1. build.json / build.js carry `cloud` from config/omega.json5 (without it
//      the service worker's Firebase auth never initializes).
//   2. A versionless app FAILS the build (Chrome refuses a manifest with no
//      version — it used to package the raw JSON5 source manifest and finish green).
//   3. The icon prune drops only icons the build never minted, in BOTH legal
//      shapes of `action.default_icon` (path string, or size→path map).
//   4. A declared consumer array is AUTHORITATIVE over the framework default —
//      an empty externally_connectable ships no origins (#260).
//   5. The firefox artifact is a real firefox artifact: chrome-only panel keys
//      translate to sidebar_action, and a missing gecko id derives from the
//      brand config — failing loudly only when there is nothing to derive (#264).
//   6. The store description assets ship RENDERED brand tokens — a `{{ brand.name }}`
//      that reaches the live listing is the bug (#289).
//   7. The build hooks resolve the NESTED path setup migrates to, with the flat
//      pre-migration path as a transition fallback — every consumer's hooks were
//      dead, and the miss printed an untagged console.warn (#571).
//
// The task module reads its project (package.json / config / dist) from cwd at
// REQUIRE time, so each test stages a temp project, chdirs into it, and requires
// the task fresh — the same model as manager.test.js's inDir().

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const vm    = require('vm');
const JSON5 = require('json5');

const SRC       = path.join(__dirname, '..', '..', '..');
const TASK_PATH = path.join(SRC, 'gulp', 'tasks', 'package.js');

// Stage a temp extension project. `files` is a relative-path → contents map
// written verbatim (dist/manifest.json, the minted icons, …).
function stageProject(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-package-task-'));

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

// The JSONP build.js assigns the snapshot onto self/window/globalThis — run it
// in a real VM context and read it back, rather than regexing the text.
function evaluateBuildJs(file) {
  const sandbox = { self: {}, window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  return sandbox.self.OMEGA_BUILD_JSON;
}

const MANIFEST = (extra) => `{ manifest_version: 3, name: 'Staged', ${extra} }`;

// Set env vars for one test, restoring exactly what was there (an empty string
// means "declared but empty", the CI-with-no-.env shape) — returns the undo.
function withEnv(vars) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

// A consumer build hook that records WHICH path the resolver found it at, and
// the SHAPE of the argument it was handed (#591).
const HOOK = (which) => `
const fs = require('fs');
const path = require('path');
module.exports = async (ctx) => {
  fs.writeFileSync(path.join(process.cwd(), 'hook-ran.json'), JSON.stringify({
    which: '${which}',
    keys: Object.keys(ctx || {}).sort(),
    projectRoot: ctx && ctx.projectRoot,
    mode: ctx && ctx.mode,
    hasManager: Boolean(ctx && ctx.manager && typeof ctx.manager.getConfig === 'function'),
  }));
};
`;

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'package task — build.json cloud, manifest version guard, icon prune',
  tests: [
    {
      name: 'build.json and build.js carry cloud from config/omega.json5',
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
            const outputDir = path.join(tmp, 'packaged', 'chromium', 'raw');
            await task.generateBuildJs(outputDir);

            const json = JSON.parse(fs.readFileSync(path.join(outputDir, 'build.json'), 'utf8'));
            ctx.expect(json.config.cloud.config.apiKey).toBe('AIza-staged');
            ctx.expect(json.config.cloud.config.projectId).toBe('demo-staged');

            // The JSONP the service worker importScripts() carries the same snapshot
            const jsonp = evaluateBuildJs(path.join(outputDir, 'build.js'));
            ctx.expect(jsonp.config.cloud.config.apiKey).toBe('AIza-staged');
            ctx.expect(jsonp.config.firebase.app.enabled).toBe(true);
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
            const outputDir = path.join(tmp, 'packaged', 'chromium', 'raw');
            await task.generateBuildJs(outputDir);
            const json = JSON.parse(fs.readFileSync(path.join(outputDir, 'build.json'), 'utf8'));
            ctx.expect(json.config.cloud).toEqual({});
            ctx.expect(json.config.firebase.app.enabled).toBe(false);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'build.js bakes the sibling backend\'s resolved emulator ports, and never in production (#300)',
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
        const ENV_KEYS = ['OMEGA_BUILD_MODE', 'OMEGA_TEST_MODE', 'NODE_ENV'];
        const bake = async (mode) => {
          const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
          ENV_KEYS.forEach((key) => delete process.env[key]);
          if (mode === 'production') process.env.OMEGA_BUILD_MODE = 'true';
          try {
            return await inProject(app, async (task) => {
              const outputDir = path.join(app, 'packaged', mode, 'raw');
              await task.generateBuildJs(outputDir);
              return JSON.parse(fs.readFileSync(path.join(outputDir, 'build.json'), 'utf8')).config;
            });
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
    {
      name: 'the manifest\'s dev origin is the RESOLVED website origin, never a baked literal (#262)',
      run: async (ctx) => {
        // Same staging as the dev.ports test: a brand with a live website app
        // that published a bumped, https origin beside its port.
        const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-dev-origin-brand-'));
        fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
        fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), `{ brand: { id: 'staged', name: 'Staged' } }`);
        fs.mkdirSync(path.join(brand, 'targets', 'website', '.temp'), { recursive: true });
        fs.writeFileSync(path.join(brand, 'targets', 'website', '.temp', 'ports.json'), JSON.stringify({
          ports: { website: 4001 }, origin: 'https://localhost:4001', pid: process.pid, startedAt: 'x',
        }));

        const app = path.join(brand, 'targets', 'extension');
        fs.mkdirSync(path.join(app, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(app, 'package.json'), `{ "name": "staged-ext", "version": "3.1.4" }`);
        fs.writeFileSync(path.join(app, 'dist', 'manifest.json'), MANIFEST(`description: 'no externally_connectable anywhere'`));

        try {
          await inProject(app, async (task) => {
            const outputDir = path.join(app, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            // Protocol AND port both follow the live dev server — the old bake
            // said http://localhost:4000 while `omega dev` served https
            ctx.expect(m.externally_connectable.matches).toEqual(['https://localhost:4001/*']);
          });
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a versionless app FAILS the package task (no green build, no raw JSON5 manifest)',
      run: async (ctx) => {
        const tmp = stageProject({
          pkg: `{ "name": "versionless-ext" }`,
          files: {
            'dist/manifest.json': MANIFEST(`description: 'no version anywhere'`),
            'dist/assets/js/placeholder.js': `// keeps the redaction walk happy\n`,
          },
        });
        try {
          await inProject(tmp, async (task) => {
            // Drive the real gulp task: it must hand its `complete` callback an error.
            // (The build-error reporter fires for real here — its notifly note in
            // the log is the failure being reported, not a test problem.)
            const failure = await new Promise((resolve) => task.packageFn(resolve));
            ctx.expect(failure).toBeInstanceOf(Error);
            ctx.expect(failure.message).toMatch(/version/);
            ctx.expect(failure.plugin).toBe('Package');

            // Never compiled: the packaged manifest is still the raw copied source
            const packaged = JSON5.parse(fs.readFileSync(path.join(tmp, 'packaged', 'chromium', 'raw', 'manifest.json'), 'utf8'));
            ctx.expect(packaged.version).toBeUndefined();
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'icon prune: string default_icon is dropped when unminted, kept when minted',
      run: async (ctx) => {
        const icon = 'assets/images/icons/icon-48x.png';
        const staged = (files) => stageProject({
          files: Object.assign({ 'dist/manifest.json': MANIFEST(`action: { default_icon: '${icon}' }`) }, files),
        });

        const missing = staged({});
        const minted  = staged({ [`dist/${icon}`]: 'PNG' });
        try {
          await inProject(missing, async (task) => {
            const outputDir = path.join(missing, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.action.default_icon).toBeUndefined();
            ctx.expect(m.version).toBe('3.1.4');
            // the full default ladder is unminted too, so `icons` goes entirely
            ctx.expect(m.icons).toBeUndefined();
          });

          await inProject(minted, async (task) => {
            const outputDir = path.join(minted, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.action.default_icon).toBe(icon);
            // the 48x default in `icons` survives on the same file
            ctx.expect(m.icons['48']).toBe(icon);
          });
        } finally {
          fs.rmSync(missing, { recursive: true, force: true });
          fs.rmSync(minted,  { recursive: true, force: true });
        }
      },
    },
    {
      name: 'icon prune: object default_icon is pruned PER ENTRY (chrome\'s size→path map)',
      run: async (ctx) => {
        const tmp = stageProject({
          files: {
            'dist/manifest.json': MANIFEST(`action: { default_icon: {
              '48': 'assets/images/icons/icon-48x.png',
              '32': 'assets/images/icons/icon-32x.png',
              '16': 'assets/images/icons/icon-16x.png',
            } }`),
            'dist/assets/images/icons/icon-16x.png': 'PNG',
          },
        });
        try {
          await inProject(tmp, async (task) => {
            const outputDir = path.join(tmp, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.action.default_icon).toEqual({ '16': 'assets/images/icons/icon-16x.png' });
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'icon prune: a fully minted object default_icon is untouched',
      run: async (ctx) => {
        const tmp = stageProject({
          files: {
            'dist/manifest.json': MANIFEST(`action: { default_icon: {
              '32': 'assets/images/icons/icon-32x.png',
              '16': 'assets/images/icons/icon-16x.png',
            } }`),
            'dist/assets/images/icons/icon-32x.png': 'PNG',
            'dist/assets/images/icons/icon-16x.png': 'PNG',
          },
        });
        try {
          await inProject(tmp, async (task) => {
            const outputDir = path.join(tmp, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.action.default_icon).toEqual({
              '32': 'assets/images/icons/icon-32x.png',
              '16': 'assets/images/icons/icon-16x.png',
            });
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'pipeline failures re-throw instead of finishing green (build.js write, malformed locale)',
      run: async (ctx) => {
        // generateBuildJs: outputDir sits under a path that is a FILE, so the
        // write throws — before #46 the catch logged and returned green.
        const buildJsTmp = stageProject({ files: { 'blocker': 'a file, not a dir' } });
        // compileLocales: a locale that is not JSON5 makes the parse throw.
        const localeTmp = stageProject({
          files: { 'dist/_locales/en/messages.json': '{ not: valid json5 ][' },
        });
        try {
          await inProject(buildJsTmp, async (task) => {
            let thrown = null;
            await task.generateBuildJs(path.join(buildJsTmp, 'blocker', 'raw')).catch((e) => { thrown = e; });
            ctx.expect(thrown).toBeInstanceOf(Error);
          });

          await inProject(localeTmp, async (task) => {
            let thrown = null;
            await task.compileLocales(path.join(localeTmp, 'out')).catch((e) => { thrown = e; });
            ctx.expect(thrown).toBeInstanceOf(Error);
          });
        } finally {
          fs.rmSync(buildJsTmp, { recursive: true, force: true });
          fs.rmSync(localeTmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'externally_connectable: an explicitly EMPTY consumer array ships NO origins (#260)',
      run: async (ctx) => {
        const tmp = stageProject({
          files: { 'dist/manifest.json': MANIFEST(`externally_connectable: { matches: [] }`) },
        });
        try {
          await inProject(tmp, async (task) => {
            const outputDir = path.join(tmp, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            // The dev origin the framework default carries never reaches the artifact
            ctx.expect(m.externally_connectable).toBeUndefined();
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'externally_connectable: a consumer array REPLACES the default, absent keeps it (#260)',
      run: async (ctx) => {
        const declared = stageProject({
          files: { 'dist/manifest.json': MANIFEST(`externally_connectable: { matches: ['https://example.com/*'] }`) },
        });
        const absent = stageProject({
          files: { 'dist/manifest.json': MANIFEST(`description: 'no externally_connectable anywhere'`) },
        });
        try {
          await inProject(declared, async (task) => {
            const outputDir = path.join(declared, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.externally_connectable.matches).toEqual(['https://example.com/*']);
          });

          await inProject(absent, async (task) => {
            const outputDir = path.join(absent, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            // No live website published an origin — the classic assumption, over
            // the protocol `omega dev` speaks by default (#262)
            ctx.expect(m.externally_connectable.matches).toEqual(['https://localhost:4000/*']);
          });
        } finally {
          fs.rmSync(declared, { recursive: true, force: true });
          fs.rmSync(absent, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'background.scripts: a declared consumer array REPLACES the framework bundle entry (#260)',
      run: async (ctx) => {
        const declared = stageProject({
          files: {
            'dist/manifest.json': MANIFEST(`
              background: { scripts: ['assets/js/my-background.js'] },
              browser_specific_settings: { gecko: { id: 'staged@example.com' } },
            `),
          },
        });
        const absent = stageProject({
          files: {
            'dist/manifest.json': MANIFEST(`browser_specific_settings: { gecko: { id: 'staged@example.com' } }`),
          },
        });

        try {
          await inProject(declared, async (task) => {
            const outputDir = path.join(declared, 'out-firefox');
            await task.compileManifest(outputDir, 'firefox');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));

            // The framework's own bundle is NOT unioned back in — a consumer
            // that swaps the background entry ships only what it declared
            ctx.expect(m.background.scripts).toEqual(['assets/js/my-background.js']);
            ctx.expect(m.background.service_worker).toBeUndefined();
          });

          await inProject(absent, async (task) => {
            const outputDir = path.join(absent, 'out-firefox');
            await task.compileManifest(outputDir, 'firefox');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));

            // Declaring nothing still gets the framework bundle
            ctx.expect(m.background.scripts).toEqual(['assets/js/components/background.bundle.js']);
          });
        } finally {
          fs.rmSync(declared, { recursive: true, force: true });
          fs.rmSync(absent, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'gecko.data_collection_permissions.required: a declared consumer array REPLACES the default (#260)',
      run: async (ctx) => {
        const tmp = stageProject({
          files: {
            'dist/manifest.json': MANIFEST(`
              browser_specific_settings: {
                gecko: {
                  id: 'staged@example.com',
                  data_collection_permissions: { required: ['none'] },
                },
              },
            `),
          },
        });

        try {
          await inProject(tmp, async (task) => {
            const outputDir = path.join(tmp, 'out-firefox');
            await task.compileManifest(outputDir, 'firefox');
            const permissions = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'))
              .browser_specific_settings.gecko.data_collection_permissions;

            // Firefox reads `none` as "collects nothing" — unioning the
            // framework's authenticationInfo back in would declare a data
            // collection the extension does not do
            ctx.expect(permissions.required).toEqual(['none']);
            // The key the consumer left alone still carries the default
            ctx.expect(permissions.optional).toEqual(['technicalAndInteraction']);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the publish workflow uploads the zips the package task actually writes (#265)',
      run: async (ctx) => {
        const workflow = fs.readFileSync(path.join(SRC, 'defaults', '.github', 'workflows', 'publish.yml'), 'utf8');
        const tmp = stageProject({});

        try {
          // packageZip writes packaged/<target>/extension.zip, one per target.
          // The release step used to upload packaged/extension.zip — a path no
          // build has ever produced, so the composed run died on its last step.
          ctx.expect(workflow).not.toContain('packaged/extension.zip');

          const referenced = [...workflow.matchAll(/packaged\/[^\s"']*extension\.zip/g)].map((match) => match[0]);
          ctx.expect(referenced.length).toBeGreaterThan(0);

          const shellGlob = referenced.find((reference) => reference.includes('*'));
          ctx.expect(shellGlob).toBeDefined();

          const matcher = new RegExp(`^${shellGlob.replace(/\./g, '\\.').replace(/\*/g, '[^/]+')}$`);

          await inProject(tmp, async (task) => {
            const targets = Object.keys(task.TARGETS);
            ctx.expect(targets.length).toBeGreaterThan(0);

            for (const target of targets) {
              ctx.expect(matcher.test(`packaged/${target}/extension.zip`)).toBe(true);
            }
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'firefox: side_panel maps to sidebar_action, the sidePanel permission is dropped, chromium keeps both (#264)',
      run: async (ctx) => {
        const tmp = stageProject({
          files: {
            'dist/manifest.json': MANIFEST(`
              permissions: ['sidePanel', 'storage'],
              side_panel: { default_path: 'views/sidepanel/index.html' },
              browser_specific_settings: { gecko: { id: 'staged@example.com' } },
            `),
          },
        });
        try {
          await inProject(tmp, async (task) => {
            const firefoxDir = path.join(tmp, 'out-firefox');
            await task.compileManifest(firefoxDir, 'firefox');
            const firefox = JSON.parse(fs.readFileSync(path.join(firefoxDir, 'manifest.json'), 'utf8'));

            // Chrome-only panel keys are gone; firefox's own key carries the panel
            ctx.expect(firefox.side_panel).toBeUndefined();
            ctx.expect(firefox.sidebar_action.default_panel).toBe('views/sidepanel/index.html');
            ctx.expect(firefox.permissions).toEqual(['storage']);
            // The background translation firefox already did stays intact
            ctx.expect(firefox.background.service_worker).toBeUndefined();
            ctx.expect(firefox.background.scripts).toContain('assets/js/components/background.bundle.js');

            const chromiumDir = path.join(tmp, 'out-chromium');
            await task.compileManifest(chromiumDir, 'chromium');
            const chromium = JSON.parse(fs.readFileSync(path.join(chromiumDir, 'manifest.json'), 'utf8'));

            ctx.expect(chromium.side_panel.default_path).toBe('views/sidepanel/index.html');
            ctx.expect(chromium.permissions).toContain('sidePanel');
            ctx.expect(chromium.sidebar_action).toBeUndefined();
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'firefox: a missing browser_specific_settings.gecko.id FAILS the compile (#264)',
      run: async (ctx) => {
        const tmp = stageProject({
          files: { 'dist/manifest.json': MANIFEST(`description: 'no gecko id anywhere'`) },
        });
        try {
          await inProject(tmp, async (task) => {
            let thrown = null;
            await task.compileManifest(path.join(tmp, 'out-firefox'), 'firefox').catch((e) => { thrown = e; });
            ctx.expect(thrown).toBeInstanceOf(Error);
            // Actionable: names the key and what to put in it
            ctx.expect(thrown.message).toMatch(/browser_specific_settings\.gecko\.id/);
            ctx.expect(fs.existsSync(path.join(tmp, 'out-firefox', 'manifest.json'))).toBe(false);

            // The same source still packages for chromium — the gate is firefox's alone
            await task.compileManifest(path.join(tmp, 'out-chromium'), 'chromium');
            ctx.expect(fs.existsSync(path.join(tmp, 'out-chromium', 'manifest.json'))).toBe(true);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'firefox: a missing gecko id DERIVES from the brand config — url host first, brand id fallback (#264)',
      run: async (ctx) => {
        // A fresh scaffold declares no gecko id but always has brand facts —
        // its first build must produce a working firefox artifact, not a throw.
        const withUrl = stageProject({
          config: `{ brand: { id: 'staged-brand', name: 'Staged', url: 'https://staged.example.com' } }`,
          files: { 'dist/manifest.json': MANIFEST(`description: 'no gecko id declared'`) },
        });
        const idOnly = stageProject({
          config: `{ brand: { id: 'staged-brand', name: 'Staged' } }`,
          files: { 'dist/manifest.json': MANIFEST(`description: 'no gecko id declared'`) },
        });

        try {
          await inProject(withUrl, async (task) => {
            const outputDir = path.join(withUrl, 'out-firefox');
            await task.compileManifest(outputDir, 'firefox');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.browser_specific_settings.gecko.id).toBe('extension@staged.example.com');
          });

          await inProject(idOnly, async (task) => {
            const outputDir = path.join(idOnly, 'out-firefox');
            await task.compileManifest(outputDir, 'firefox');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.browser_specific_settings.gecko.id).toBe('extension@staged-brand.extension');
          });
        } finally {
          fs.rmSync(withUrl, { recursive: true, force: true });
          fs.rmSync(idOnly, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'store description assets ship RENDERED brand tokens — English and translated (#289)',
      run: async (ctx) => {
        // The scaffolded config/description.md is written with `{{ brand.name }}`
        // tokens; copied verbatim they reach the live store listing unrendered.
        const tmp = stageProject({
          config: `{ brand: { id: 'staged', name: 'Staged Brand', url: 'https://staged.example.com' } }`,
          files: {
            'config/description.md': `{{ brand.name }} makes browsing better.\nGet it at {{ brand.url }}.\n`,
            // A translated variant carries the same tokens through the translator
            'translations/es/description.md': `<!-- omega:source abc123abc123 -->\n{{ brand.name }} mejora tu navegación.\n`,
          },
        });
        try {
          await inProject(tmp, async (task) => {
            await task.deployStoreAssets();

            const descDir = path.join(tmp, 'packaged', 'assets', 'description');

            const en = fs.readFileSync(path.join(descDir, 'en.md'), 'utf8');
            ctx.expect(en).toContain('Staged Brand makes browsing better.');
            ctx.expect(en).toContain('Get it at https://staged.example.com.');
            ctx.expect(en).not.toContain('{{');

            const es = fs.readFileSync(path.join(descDir, 'es.md'), 'utf8');
            ctx.expect(es).toContain('Staged Brand mejora tu navegación.');
            ctx.expect(es).not.toContain('{{');
            // the source marker is still stripped
            ctx.expect(es).not.toContain('omega:source');
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'homepage_url is baked from brand.url on every target, declared wins, absent ships nothing (#576)',
      run: async (ctx) => {
        const derived = stageProject({
          config: `{ brand: { id: 'staged', name: 'Staged', url: 'https://staged.example.com/extension' } }`,
          files: { 'dist/manifest.json': MANIFEST(`description: 'no homepage_url declared'`) },
        });
        const declared = stageProject({
          config: `{ brand: { id: 'staged', name: 'Staged', url: 'https://staged.example.com' } }`,
          files: { 'dist/manifest.json': MANIFEST(`homepage_url: 'https://staged.example.com/chrome'`) },
        });
        const noBrandUrl = stageProject({
          config: `{ brand: { id: 'staged', name: 'Staged' } }`,
          files: { 'dist/manifest.json': MANIFEST(`browser_specific_settings: { gecko: { id: 'staged@example.com' } }`) },
        });

        try {
          // Chrome and Firefox both link the store listing's developer site from it
          for (const target of ['chromium', 'firefox']) {
            await inProject(derived, async (task) => {
              const outputDir = path.join(derived, `out-${target}`);
              await task.compileManifest(outputDir, target);
              const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
              ctx.expect(m.homepage_url).toBe('https://staged.example.com/extension');
            });
          }

          await inProject(declared, async (task) => {
            const outputDir = path.join(declared, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.homepage_url).toBe('https://staged.example.com/chrome');
          });

          await inProject(noBrandUrl, async (task) => {
            const outputDir = path.join(noBrandUrl, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.homepage_url).toBeUndefined();
          });
        } finally {
          fs.rmSync(derived, { recursive: true, force: true });
          fs.rmSync(declared, { recursive: true, force: true });
          fs.rmSync(noBrandUrl, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'externally_connectable: a build-mode default is the BRAND origin, no dev origin (#583)',
      run: async (ctx) => {
        const tmp = stageProject({
          config: `{ brand: { id: 'staged', name: 'Staged', url: 'https://staged.example.com' } }`,
          files: { 'dist/manifest.json': MANIFEST(`description: 'no externally_connectable anywhere'`) },
        });
        const restore = withEnv({ OMEGA_BUILD_MODE: 'true' });

        try {
          await inProject(tmp, async (task) => {
            const outputDir = path.join(tmp, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));

            // The published extension is reachable from the brand's own site;
            // the localhost dev origin is not in a packaged build
            ctx.expect(m.externally_connectable.matches).toEqual(['https://staged.example.com/*']);
          });
        } finally {
          restore();
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'externally_connectable: a dev default carries the brand origin AND the dev origin (#583)',
      run: async (ctx) => {
        const tmp = stageProject({
          config: `{ brand: { id: 'staged', name: 'Staged', url: 'https://staged.example.com/' } }`,
          files: { 'dist/manifest.json': MANIFEST(`description: 'no externally_connectable anywhere'`) },
        });

        try {
          await inProject(tmp, async (task) => {
            const outputDir = path.join(tmp, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));

            // A trailing slash in brand.url is normalized to a match pattern
            ctx.expect(m.externally_connectable.matches).toEqual([
              'https://staged.example.com/*',
              'https://localhost:4000/*',
            ]);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'externally_connectable: a DECLARED consumer value still wins in build mode (#583, #260)',
      run: async (ctx) => {
        const declared = stageProject({
          config: `{ brand: { id: 'staged', name: 'Staged', url: 'https://staged.example.com' } }`,
          files: { 'dist/manifest.json': MANIFEST(`externally_connectable: { matches: ['https://partner.example.com/*'] }`) },
        });
        const emptied = stageProject({
          config: `{ brand: { id: 'staged', name: 'Staged', url: 'https://staged.example.com' } }`,
          files: { 'dist/manifest.json': MANIFEST(`externally_connectable: { matches: [] }`) },
        });
        const restore = withEnv({ OMEGA_BUILD_MODE: 'true' });

        try {
          await inProject(declared, async (task) => {
            const outputDir = path.join(declared, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.externally_connectable.matches).toEqual(['https://partner.example.com/*']);
          });

          await inProject(emptied, async (task) => {
            const outputDir = path.join(emptied, 'out');
            await task.compileManifest(outputDir, 'chromium');
            const m = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
            ctx.expect(m.externally_connectable).toBeUndefined();
          });
        } finally {
          restore();
          fs.rmSync(declared, { recursive: true, force: true });
          fs.rmSync(emptied, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the publish workflow injects GOOGLE_ANALYTICS_SECRET from the repo secrets (#582)',
      run: async (ctx) => {
        const workflow = fs.readFileSync(path.join(SRC, 'defaults', '.github', 'workflows', 'publish.yml'), 'utf8');

        // A dispatched CI run has no `.env`, so the secret only reaches the
        // build through the workflow env — without this line every published
        // extension baked an empty GA secret and sent no events.
        ctx.expect(workflow).toContain('GOOGLE_ANALYTICS_SECRET: ${{ secrets.GOOGLE_ANALYTICS_SECRET }}');
      },
    },
    {
      name: 'build hooks run from the NESTED hooks/build/pre.js setup migrates to (#571)',
      run: async (ctx) => {
        const tmp = stageProject({
          files: { 'hooks/build/pre.js': HOOK('nested') },
        });
        try {
          await inProject(tmp, async (task) => {
            await task.hook('build:pre');
            const ran = JSON.parse(fs.readFileSync(path.join(tmp, 'hook-ran.json'), 'utf8'));
            ctx.expect(ran.which).toBe('nested');
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'build hooks still run from the flat pre-migration hooks/build:pre.js (#571)',
      run: async (ctx) => {
        const tmp = stageProject({
          files: { 'hooks/build:pre.js': HOOK('flat') },
        });
        try {
          await inProject(tmp, async (task) => {
            await task.hook('build:pre');
            const ran = JSON.parse(fs.readFileSync(path.join(tmp, 'hook-ran.json'), 'utf8'));
            ctx.expect(ran.which).toBe('flat');
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a build hook receives the ONE OMEGA ctx shape — { manager, projectRoot, mode } (#591)',
      run: async (ctx) => {
        const tmp = stageProject({
          files: { 'hooks/build/pre.js': HOOK('nested') },
        });
        try {
          await inProject(tmp, async (task) => {
            await task.hook('build:pre');

            const ran = JSON.parse(fs.readFileSync(path.join(tmp, 'hook-ran.json'), 'utf8'));
            ctx.expect(ran.keys).toEqual(['manager', 'mode', 'projectRoot']);
            ctx.expect(ran.projectRoot).toBe(fs.realpathSync(tmp));
            ctx.expect(ran.mode).toBe('development');
            ctx.expect(ran.hasManager).toBe(true);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a build hook run under OMEGA_BUILD_MODE gets mode: production (#591)',
      run: async (ctx) => {
        const tmp = stageProject({
          files: { 'hooks/build/pre.js': HOOK('nested') },
        });
        const restore = withEnv({ OMEGA_BUILD_MODE: 'true' });
        try {
          await inProject(tmp, async (task) => {
            await task.hook('build:pre');

            const ran = JSON.parse(fs.readFileSync(path.join(tmp, 'hook-ran.json'), 'utf8'));
            ctx.expect(ran.mode).toBe('production');
          });
        } finally {
          restore();
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a project with no hook at all logs the miss through the framework logger, never a bare console.warn (#571)',
      run: async (ctx) => {
        const tmp = stageProject({});
        const warned = [];
        const realWarn = console.warn;
        console.warn = (...args) => warned.push(args.join(' '));
        try {
          await inProject(tmp, async (task) => {
            await task.hook('build:post');
          });
          ctx.expect(warned).toEqual([]);
        } finally {
          console.warn = realWarn;
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
};

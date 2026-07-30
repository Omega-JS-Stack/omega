// Build-layer tests for gulp/tasks/package.js — the three things a consumer's
// packaged output lives or dies by (#46):
//
//   1. build.json / build.js carry `cloud` from config/omega.json5 (without it
//      the service worker's Firebase auth never initializes).
//   2. A versionless app FAILS the build (Chrome refuses a manifest with no
//      version — it used to package the raw JSON5 source manifest and finish green).
//   3. The icon prune drops only icons the build never minted, in BOTH legal
//      shapes of `action.default_icon` (path string, or size→path map).
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
  ],
};

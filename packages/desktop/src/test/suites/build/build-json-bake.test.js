// Build-layer tests for what the build bakes as OMEGA_BUILD_JSON
// ([#894](https://github.com/Omega-JS-Stack/omega/issues/894),
// [#743](https://github.com/Omega-JS-Stack/omega/issues/743)).
//
// One wrapper and one name on every surface: `{ config, package, mode, license,
// builtAt }`. What differs is WHO reads it, and how it is delivered:
//
//   main / preload  the RESOLVED config, whole, as an esbuild `define` plus the
//                   banner. The main process boots from it (main.js reads
//                   OMEGA_BUILD_JSON.config in a packaged app, where
//                   config/omega.json5 is inside the asar), so autoUpdate,
//                   platforms, startup and the rest have to be there. Both are
//                   Node, neither is a public surface.
//   renderer        the browser-safe subset (@omega.js/config's clientConfig),
//                   delivered as the ONE `dist/build.js` every view's shell
//                   loads ahead of its bundle: the same file, the same shape and
//                   the same load order web and the extension use. A renderer is
//                   a public surface, its bundle is readable from DevTools, so
//                   the GCP account facts and the brand's provisioning sections
//                   must not be in it.

const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const defineCases = require('@omega.js/devkit/test/define-cases');

const FRAMEWORK_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SRC = path.join(FRAMEWORK_ROOT, 'src');
const TASK = path.join(SRC, 'gulp', 'tasks', 'bundle.js');
const PAGE_TEMPLATE = path.join(SRC, 'config', 'page-template.html');

// A resolved desktop config with one section from each side of the gate.
const CONFIG = () => ({
  brand: { id: 'paperloom', name: 'Paperloom' },
  theme: { id: 'classy' },
  cloud: {
    provider: 'firebase',
    config: { apiKey: 'public-web-key', projectId: 'paperloom-prod' },
    billingAccount: '01ABCD-234567-89EFGH',
  },
  app: { productName: 'Paperloom' },
  platforms: { windows: { signing: 'cloud' } },
  certificates: { providers: { apple: { teamId: 'TEAM' } } },
  account: { admins: [{ email: 'root@paperloom.com' }] },
  repo: { provider: 'github', org: 'Paperloom' },
});

const MODE = { environment: 'production', build: true, publish: false, server: false };

const INPUT = () => {
  const { buildFacts } = require(TASK);
  const pkg = { name: 'paperloom', version: '3.1.4' };

  return {
    config: CONFIG(),
    facts: buildFacts({ pkg, mode: MODE, dev: { ports: { backend: 5002 } } }),
    pkg,
    mode: MODE,
    license: { status: 'licensed', payments: 'live', attribution: 'removed' },
  };
};

// Run a `build.js` the way a browser does: a scope whose only global is `self`.
function loadBuildJs(file) {
  const scope = { self: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), scope);
  return scope.self.OMEGA_BUILD_JSON;
}

// Stage a minimal desktop project and run the REAL bundle task in it: the task
// reads its project (package.json / config / dist) from cwd at require time.
async function inStagedProject(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-build-json-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{ "name": "staged-desktop", "version": "3.1.4" }');
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), `{
    brand: { id: 'staged', name: 'Staged' },
    cloud: { config: { apiKey: 'AIza-staged', projectId: 'demo-staged' }, billingAccount: '01ABCD-234567-89EFGH' },
    targets: { desktop: { type: 'desktop' } },
  }`);

  const write = (relative, contents) => {
    const full = path.join(tmp, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  write('src/main.js', 'globalThis.__main = OMEGA_BUILD_JSON.config.brand.id;\n');
  write('src/preload.js', 'globalThis.__preload = OMEGA_BUILD_JSON.config.brand.id;\n');
  write('src/assets/js/components/main/index.js', [
    'try { globalThis.__fromWindow = window.OMEGA_BUILD_JSON.config.brand.id; } catch (e) { globalThis.__fromWindow = null; }',
    '',
  ].join('\n'));

  const oldCwd = process.cwd();
  const flush = () => {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(SRC + path.sep)) delete require.cache[key];
    }
  };

  flush();
  try {
    process.chdir(tmp);
    const task = require(TASK);
    await new Promise((resolve, reject) => task((error) => (error ? reject(error) : resolve())));
    return await fn(tmp);
  } finally {
    process.chdir(oldCwd);
    flush();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'build json bake: one wrapper, one dist/build.js for the renderer (#894, #743)',
  timeout: 180000,
  tests: [
    {
      name: 'the wrapper is { config, package, mode, license, builtAt } on both halves',
      run: (ctx) => {
        const { composeBuildJson, composeClientBuildJson } = require(TASK);

        const input = INPUT();
        const buildJson = composeBuildJson(input);
        const clientJson = composeClientBuildJson(input);

        for (const blob of [buildJson, clientJson]) {
          ctx.expect(Object.keys(blob).sort()).toEqual(['builtAt', 'config', 'license', 'mode', 'package']);
          ctx.expect(blob.package.version).toBe('3.1.4');
          ctx.expect(blob.license.status).toBe('licensed');
          ctx.expect(typeof blob.builtAt).toBe('string');
          // The mode is the same THREE keys everywhere (#894): desktop's own
          // `server` verdict stays inside the build module.
          ctx.expect(Object.keys(blob.mode).sort()).toEqual(['build', 'environment', 'publish']);
          ctx.expect(blob.mode.environment).toBe('production');
          ctx.expect(blob.mode.build).toBe(true);
        }
      },
    },
    {
      name: 'main and preload keep the WHOLE resolved config: the main process boots from it',
      run: (ctx) => {
        const { composeBuildJson } = require(TASK);

        const buildJson = composeBuildJson(INPUT());

        ctx.expect(buildJson.config.platforms.windows.signing).toBe('cloud');
        ctx.expect(buildJson.config.certificates.providers.apple.teamId).toBe('TEAM');
        ctx.expect(buildJson.config.cloud.billingAccount).toBe('01ABCD-234567-89EFGH');
        // Plus the build facts main reads off it
        ctx.expect(buildJson.config.version).toBe('3.1.4');
        ctx.expect(buildJson.config.dev.ports.backend).toBe(5002);
      },
    },
    {
      name: 'the RENDERER snapshot carries the client subset, and no credential section at all',
      run: (ctx) => {
        const { composeClientBuildJson } = require(TASK);

        const clientJson = composeClientBuildJson(INPUT());

        // What the renderer's @omega.js/client actually boots from
        ctx.expect(clientJson.config.brand.id).toBe('paperloom');
        ctx.expect(clientJson.config.theme.id).toBe('classy');
        ctx.expect(clientJson.config.cloud.config.apiKey).toBe('public-web-key');
        ctx.expect(clientJson.config.app.productName).toBe('Paperloom');
        ctx.expect(clientJson.config.version).toBe('3.1.4');
        ctx.expect(clientJson.config.dev.ports.backend).toBe(5002);
        // The runtime is BAKED (#896): the client's own sniff has no Electron
        // signal to find in a renderer and would answer 'web'.
        ctx.expect(clientJson.config.runtime).toBe('electron');

        // …and nothing a public surface has no business carrying
        ctx.expect(clientJson.config.platforms).toBeUndefined();
        ctx.expect(clientJson.config.certificates).toBeUndefined();
        ctx.expect(clientJson.config.account).toBeUndefined();
        ctx.expect(clientJson.config.repo).toBeUndefined();
        ctx.expect(clientJson.config.cloud.billingAccount).toBeUndefined();
      },
    },
    {
      // The load order the renderer depends on: the shell's FIRST script is the
      // snapshot, ahead of the view's own bundle. `../../build.js` from
      // dist/views/<view>/ is dist/build.js, and a packaged app resolves it
      // inside the asar exactly as the bundle tag beside it does.
      name: 'the page template loads build.js as its first script, ahead of the view bundle (#743)',
      run: (ctx) => {
        const template = fs.readFileSync(PAGE_TEMPLATE, 'utf8');
        const loader = template.indexOf('<script src="../../build.js');
        const bundle = template.indexOf('<script src="../../assets/js/components/');

        ctx.expect(loader > -1).toBe(true);
        ctx.expect(bundle > loader).toBe(true);
        // The FIRST script tag in the shell, full stop.
        ctx.expect(template.indexOf('<script')).toBe(loader);
      },
    },
    {
      name: 'a real build writes ONE dist/build.js, and the renderer bundle carries no copy (#743)',
      run: async (ctx) => {
        await inStagedProject(async (tmp) => {
          const loader = path.join(tmp, 'dist', 'build.js');
          ctx.expect(fs.existsSync(loader)).toBe(true);

          const buildJson = loadBuildJs(loader);
          ctx.expect(buildJson.config.brand.id).toBe('staged');
          ctx.expect(buildJson.config.runtime).toBe('electron');
          ctx.expect(buildJson.config.cloud.config.apiKey).toBe('AIza-staged');
          // The subset gate ran: a provisioning fact never reaches the file a
          // renderer (and anyone with DevTools) reads.
          ctx.expect(buildJson.config.cloud.billingAccount).toBeUndefined();

          // The renderer bundle carries neither the banner nor the define: with
          // no build.js loaded there is no snapshot in that scope at all.
          const rendererBundle = path.join(tmp, 'dist', 'assets', 'js', 'components', 'main.bundle.js');
          const source = fs.readFileSync(rendererBundle, 'utf8');
          ctx.expect(source.includes('OMEGA_BUILD_JSON={')).toBe(false);
          ctx.expect(source.includes('OMEGA_BUILD_JSON = {')).toBe(false);

          const scope = { self: {} };
          scope.window = scope.self;
          vm.runInNewContext(source, scope);
          ctx.expect(scope.__fromWindow).toBe(null);

          // Loaded the way a view loads it, build.js first, it answers.
          const loaded = { self: {} };
          loaded.window = loaded.self;
          vm.runInNewContext(fs.readFileSync(loader, 'utf8'), loaded);
          vm.runInNewContext(source, loaded);
          ctx.expect(loaded.__fromWindow).toBe('staged');

          // main and preload still carry the WHOLE config as a define: they are
          // Node, and a packaged main boots from it inside the asar.
          const mainBundle = fs.readFileSync(path.join(tmp, 'dist', 'main.bundle.js'), 'utf8');
          ctx.expect(mainBundle.includes('OMEGA_BUILD_JSON')).toBe(true);
          ctx.expect(mainBundle.includes('01ABCD-234567-89EFGH')).toBe(true);
          ctx.expect(fs.existsSync(path.join(tmp, 'dist', 'preload.bundle.js'))).toBe(true);
        });
      },
    },
  ],
});

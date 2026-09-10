// The renderer's Node-builtin shim ([#737](https://github.com/Omega-JS-Stack/omega/issues/737)).
//
// The renderer runs with contextIsolation on — a browser-like environment with
// no Node globals — but libraries bundled through @omega.js/client IMPORT `fs`,
// `path`, `crypto` and friends on code paths their browser builds never take.
// webpack answered `resolve.fallback: { fs: false, … }`; esbuild has no such
// option, so the same list goes to @omega.js/devkit's `emptyModulesPlugin`.
// Without it a renderer build FAILS ("Could not resolve"), which is one half of
// what this pins. The other half is `electron`: it RESOLVES fine from a desktop
// project, so a hook that resolved before substituting would inline the real
// package — the binary launcher, `spawnSync` and all — into the one process
// that must never reach it.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FRAMEWORK_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { bundle } = require('@omega.js/devkit/bundle');
const { emptyModulesPlugin } = require('@omega.js/devkit/empty-modules-plugin');
const task = require(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'bundle.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

// A browser bundle of an entry that imports built-ins the way a real library
// spells them, built with the renderer lane's platform and its shim list.
async function buildRenderer(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-desktop-shims-'));
  fs.writeFileSync(path.join(dir, 'entry.js'), source);
  const outfile = path.join(dir, 'dist', 'entry.bundle.js');

  try {
    await bundle({
      frameworkRoot: FRAMEWORK_ROOT,
      entries: [path.join(dir, 'entry.js')],
      outfile,
      platform: 'browser',
      format: 'iife',
      dev: true,
      plugins: [emptyModulesPlugin(task.RENDERER_EMPTY_MODULES)],
    });
    return fs.readFileSync(outfile, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'renderer Node-builtin shims — a browser bundle answers the imports webpack fallbacks used to',
  timeout: 60000,
  tests: [
    {
      name: 'every shimmed name resolves to an empty module instead of failing the build',
      run: async (ctx) => {
        const source = task.RENDERER_EMPTY_MODULES
          .map((name, index) => `import m${index} from '${name}';\nglobalThis.probe${index} = m${index};`)
          .join('\n');
        const built = await buildRenderer(source);

        ctx.expect(/require\(["'](node:)?(fs|path|crypto|child_process|electron)["']\)/.test(built)).toBe(false);
      },
    },

    {
      name: 'the `node:` spelling of the same built-in is shimmed too',
      run: async (ctx) => {
        const built = await buildRenderer("import fsp from 'node:fs';\nglobalThis.probe = fsp;\n");
        ctx.expect(/require\(["']node:fs["']\)/.test(built)).toBe(false);
      },
    },

    {
      // The absence of a `require("electron")` call proves nothing on its own —
      // a hook that RESOLVED electron first would inline its source and leave no
      // require behind either. These are strings out of electron's own
      // index.js: the binary launcher, its download shell-out, and the path file
      // it reads. None of them may appear in a renderer bundle.
      name: 'electron is SUBSTITUTED, not resolved — none of its launcher source reaches the bundle',
      run: async (ctx) => {
        const built = await buildRenderer("import electron from 'electron';\nglobalThis.probe = electron;\n");

        ctx.expect(built.includes('spawnSync')).toBe(false);
        ctx.expect(built.includes('path.txt')).toBe(false);
        ctx.expect(built.includes('Downloading Electron binary')).toBe(false);
        ctx.expect(built.includes('ELECTRON_OVERRIDE_DIST_PATH')).toBe(false);
      },
    },

    {
      name: 'electron is on the list — a renderer reaching the real module is a hole, not a polyfill',
      run: (ctx) => {
        ctx.expect(task.RENDERER_EMPTY_MODULES.includes('electron')).toBe(true);
      },
    },

    {
      name: 'a name NOT on the list still fails with the bundler\'s own resolution error',
      run: async (ctx) => {
        let error = null;
        try {
          await buildRenderer("import 'totally-not-a-node-builtin';\n");
        } catch (e) {
          error = e;
        }
        ctx.expect(Boolean(error)).toBe(true);
        ctx.expect(error.message).toContain('totally-not-a-node-builtin');
      },
    },

    {
      name: 'registering the hook with no names throws — a shim that shims nothing is the bug it prevents',
      run: (ctx) => {
        let error = null;
        try {
          emptyModulesPlugin([]);
        } catch (e) {
          error = e;
        }
        ctx.expect(Boolean(error)).toBe(true);
        ctx.expect(error.message).toContain('non-empty array');
      },
    },
  ],
});

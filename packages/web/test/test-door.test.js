/**
 * The test door's Node half: `require(name)` and `loadModule(path, browser)`
 * on `@omega.js/web/test`. A brand's web suite is Node code, so it asks web for
 * a framework dependency (web's own copy answers, the twin of the backend's
 * `omega.require`) and for a bundle of one page module, built with web's own
 * aliases and evaluated over the browser fakes the test passes.
 *
 * The page fixtures live in a temp consumer tree, ESM as a brand's
 * `src/assets/js/pages/*.js` are, importing a real core lib through
 * `__main_assets__/` and the runtime through `@omega.js/web/runtime`.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const defineCases = require('@omega.js/devkit/test/define-cases');
const door = require('../src/test/index.js');

const PKG = path.resolve(__dirname, '..');
const DOOR = path.join(PKG, 'src', 'test', 'index.js');
const LOAD_PREFIX = 'omega-load-module-';

// Each load exports a fresh token, and the bundle's own path (`__filename` is
// the required outfile), so the test can find the dir the bundle landed in.
const PAGE_SOURCE = `import omega from '@omega.js/web/runtime';
import { mapSrcset } from '__main_assets__/js/libs/srcset.js';

export const runtime = omega;
export const lib = mapSrcset;
export const seenDocument = globalThis.document;
export const seenWindow = globalThis.window;
export const token = Symbol('load');
export const bundlePath = typeof __filename === 'string' ? __filename : null;
`;

const BROKEN_SOURCE = `import missing from './no-such-module.js';

export default missing;
`;

let root = null;
let pagePath = null;
let brokenPath = null;

/** The helper's temp dirs present under the OS temp dir right now. */
function loadDirs() {
  return new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(LOAD_PREFIX)));
}

module.exports = defineCases({
  type: 'group',
  description: 'web test door: require and loadModule',
  setup: () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-test-door-'));
    const pagesDir = path.join(root, 'src', 'assets', 'js', 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    pagePath = path.join(pagesDir, 'page.js');
    brokenPath = path.join(pagesDir, 'broken.js');
    fs.writeFileSync(pagePath, PAGE_SOURCE);
    fs.writeFileSync(brokenPath, BROKEN_SOURCE);
  },
  cleanup: () => {
    fs.rmSync(root, { recursive: true, force: true });
  },
  tests: [
    {
      name: "require('esbuild') answers web's own copy, even for a brand with no esbuild",
      run: (ctx) => {
        const webRequire = createRequire(path.join(PKG, 'package.json'));
        ctx.expect(door.require('esbuild')).toBe(webRequire('esbuild'));

        const empty = path.join(root, 'empty');
        fs.mkdirSync(empty);
        const child = spawnSync(process.execPath, [
          '-e',
          `process.stdout.write(require(${JSON.stringify(DOOR)}).require('esbuild').version)`,
        ], { cwd: empty, encoding: 'utf8' });

        ctx.expect(child.status, child.stderr).toBe(0);
        ctx.expect(child.stdout).toBe(webRequire('esbuild').version);
      },
    },
    {
      name: "require('no-such-package') throws MODULE_NOT_FOUND",
      run: (ctx) => {
        ctx.expect(() => door.require('no-such-package')).toThrow({ code: 'MODULE_NOT_FOUND' });
      },
    },
    {
      name: 'loadModule returns the exports, the runtime and the globals being the ones passed',
      run: async (ctx) => {
        const omega = { name: 'fake-omega' };
        const document = { name: 'fake-document' };
        const window = { name: 'fake-window' };
        const loaded = await door.loadModule(pagePath, { omega, document, window });

        ctx.expect(loaded.runtime).toBe(omega);
        ctx.expect(loaded.lib).toBeTypeOf('function');
        ctx.expect(loaded.lib('a.png 1x, b.png 2x', (url) => `/cdn/${url}`)).toBe('/cdn/a.png 1x, /cdn/b.png 2x');
        ctx.expect(loaded.seenDocument).toBe(document);
        ctx.expect(loaded.seenWindow).toBe(window);
      },
    },
    {
      name: 'loadModule puts globalThis.document and window back: absent stays absent, a prior value returns',
      run: async (ctx) => {
        ctx.expect('document' in globalThis, 'precondition: no document global').toBe(false);
        ctx.expect('window' in globalThis, 'precondition: no window global').toBe(false);

        await door.loadModule(pagePath, { document: {}, window: {} });
        ctx.expect('document' in globalThis).toBe(false);
        ctx.expect('window' in globalThis).toBe(false);

        const prior = { name: 'prior-window' };
        globalThis.window = prior;
        ctx.after(() => { delete globalThis.window; });
        const fake = { name: 'fake-window' };

        const loaded = await door.loadModule(pagePath, { window: fake });
        ctx.expect(loaded.seenWindow).toBe(fake);
        ctx.expect(globalThis.window).toBe(prior);
        ctx.expect('document' in globalThis).toBe(false);
      },
    },
    {
      name: 'two loads of the same path answer two distinct module objects',
      run: async (ctx) => {
        const first = await door.loadModule(pagePath, {});
        const second = await door.loadModule(pagePath, {});

        ctx.expect(first).not.toBe(second);
        ctx.expect(first.token).not.toBe(second.token);
      },
    },
    {
      name: 'the temp dir the bundle landed in is gone after the call, on success and on a failed build',
      run: async (ctx) => {
        const before = loadDirs();

        const loaded = await door.loadModule(pagePath, {});
        ctx.expect(loaded.bundlePath, 'the bundle was required from a file').toBeTypeOf('string');
        ctx.expect(fs.existsSync(path.dirname(loaded.bundlePath)), `${loaded.bundlePath}'s dir remains`).toBe(false);

        await ctx.expect(() => door.loadModule(brokenPath, {})).toThrow();

        const leftover = [...loadDirs()].filter((name) => !before.has(name));
        ctx.expect(leftover).toEqual([]);
      },
    },
  ],
});

/**
 * The conditional-module gate in `core/js/main.js`, and which way each switch
 * reads when the config never mentions it
 * ([#551](https://github.com/Omega-JS-Stack/omega/issues/551)).
 *
 * `client.consent.enabled` is a schema DEFAULT-TRUE key: the banner and the
 * provider gate ship unless a brand says otherwise. The loop read it
 * strict-truthy, so any config assembled outside loadConfig()'s materialization
 * silently shipped a site with no consent gate at all — the exact hole #383
 * closed, reopened by the read. The other two modules are opt-in: an absent
 * section means not configured, and the flip must not switch them on.
 *
 * Browser code behind two bundler aliases, so the harness drives the REAL
 * main.js through esbuild (the idiom consent-gating.test.js uses) with every
 * module it pulls in replaced by a recorder, and the web runtime instance a
 * stub handed in as `{ omega, options }`: what this pins is WHICH modules a
 * config loads, not what any of them then does.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const PKG = path.join(__dirname, '..');
const CORE_DIR = path.join(PKG, 'core');
const CORE_JS = path.join(CORE_DIR, 'js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-main-modules-'));
const BUNDLE = path.join(BUNDLE_DIR, 'main.cjs');

let building = null;

/**
 * Every module main.js imports, static or dynamic, as a recorder that pushes
 * its own path onto `globalThis.__loaded`. The named exports are the ones
 * main.js destructures — a new one fails the BUILD, loudly, rather than
 * silently loading nothing.
 */
function recorderModule(id) {
  return [
    `const record = () => globalThis.__loaded.push(${JSON.stringify(id)});`,
    `export default record;`,
    `export const setupPasswordToggle = record;`,
    `export const setupAlertDismiss = record;`,
    `export const setupCopy = record;`,
    `export const configureAnalytics = record;`,
    `export const createExitPopup = record;`,
  ].join('\n');
}

function bundleOnce() {
  building ||= esbuild.build({
    stdin: {
      contents: `export { default } from './main.js';`,
      resolveDir: CORE_JS,
      loader: 'js',
    },
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^(__main_assets__|__theme__)\// }, (args) => {
          return { path: args.path, namespace: 'omega-module-recorder' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-module-recorder' }, (args) => {
          return { contents: recorderModule(path.basename(args.path)), loader: 'js' };
        });
      },
    }],
  });

  return building;
}

/**
 * Boot the real main.js against one client config, and hand back the module
 * files it chose to load.
 *
 * @param {object} config - The runtime instance's config blob, as main.js reads it
 * @returns {Promise<string[]>}
 */
async function boot(config, page = {}) {
  await bundleOnce();

  globalThis.__loaded = [];
  const omega = {
    config: config,
    isDevelopment: () => page.development === true,
  };
  // Only what main.js reads off the document: the iframe mark `body.html`
  // stamps before first paint (#555).
  globalThis.document = {
    documentElement: {
      getAttribute: (name) => (name === 'data-iframed' ? String(page.iframed === true) : null),
    },
  };

  delete require.cache[require.resolve(BUNDLE)];
  const bundle = require(BUNDLE);

  await bundle.default({ omega, options: {} });

  return globalThis.__loaded;
}

module.exports = defineCases({
  type: 'group',
  description: 'main-conditional-modules',
  tests: [
    {
      name: 'a config that never mentions consent still ships the banner',
      run: async (ctx) => {
        // The default-true read (#551): a client blob assembled outside loadConfig()'s
        // materialization — a test fixture, a hand-built Manager.config — carries no
        // `consent` key at all, and the schema promises the gate is ON.
        const loaded = await boot({});

        ctx.expect(loaded.includes('consent.js'), `the consent gate is default-ON, so an unmentioned key loads it — loaded ${JSON.stringify(loaded)}`).toBeTruthy();
      },
    },

    {
      name: 'an explicit false is the only thing that drops the consent gate',
      run: async (ctx) => {
        const loaded = await boot({ consent: { enabled: false } });

        ctx.expect(!loaded.includes('consent.js'), `only \`enabled: false\` turns the banner off — loaded ${JSON.stringify(loaded)}`).toBeTruthy();
      },
    },

    {
      name: 'the opt-in modules stay opt-in',
      run: async (ctx) => {
        // The flip is per-key, not per-loop: an absent exit-popup or social-sharing
        // section is a feature that was never configured, and turning them on for
        // every brand would be the same bug pointed the other way.
        const loaded = await boot({});

        ctx.expect(!loaded.includes('exit-popup.js'), `an unconfigured exit popup stays off — loaded ${JSON.stringify(loaded)}`).toBeTruthy();
        ctx.expect(!loaded.includes('social-sharing.js'), `unconfigured social sharing stays off — loaded ${JSON.stringify(loaded)}`).toBeTruthy();
      },
    },

    {
      name: 'a configured opt-in module still loads',
      run: async (ctx) => {
        const loaded = await boot({ exitPopup: { enabled: true }, socialSharing: { enabled: true } });

        ctx.expect(loaded.includes('exit-popup.js'), `an enabled exit popup loads as before — loaded ${JSON.stringify(loaded)}`).toBeTruthy();
        ctx.expect(loaded.includes('social-sharing.js'), `enabled social sharing loads as before — loaded ${JSON.stringify(loaded)}`).toBeTruthy();
      },
    },

    /**
     * #555 — the dev palette is page chrome, and a showcase frame is not a page.
     *
     * The gallery stacks one embedded document per demo variant, so a pull-tab per
     * frame is the same noise the cookie banner and the chat widget already stopped
     * making there (Ian's ruling 2026-08-25). Neither of those could be gated in
     * main.js — the client mounts chatsy before the global module runs — so they
     * ride the frame page's own frontmatter. The palette CAN be, because main.js is
     * what imports it, and `core/_includes/core/body.html` stamps
     * `html[data-iframed]` before first paint.
     */
    {
      name: '#555: a page inside a frame loads no dev palette',
      run: async (ctx) => {
        const loaded = await boot({}, { development: true, iframed: true });

        ctx.expect(!loaded.includes('dev-palette.js'), `an embedded frame gets no pull-tab — loaded ${JSON.stringify(loaded)}`).toBeTruthy();
        ctx.expect(loaded.includes('dev-icon-audit.js'), `the rest of the dev lane is untouched — loaded ${JSON.stringify(loaded)}`).toBeTruthy();
      },
    },

    {
      name: '#555: a normal dev page still gets the palette',
      run: async (ctx) => {
        const loaded = await boot({}, { development: true });

        ctx.expect(loaded.includes('dev-palette.js'), `top-level dev pages are unchanged — loaded ${JSON.stringify(loaded)}`).toBeTruthy();
      },
    },

    {
      name: '#555: production loads neither, framed or not',
      run: async (ctx) => {
        for (const iframed of [false, true]) {
          const loaded = await boot({}, { iframed });
          ctx.expect(!loaded.includes('dev-palette.js'), `iframed=${iframed}: the whole dev lane is development-only`).toBeTruthy();
          ctx.expect(!loaded.includes('dev-icon-audit.js'), `iframed=${iframed}: …including the icon audit`).toBeTruthy();
        }
      },
    },
  ],
});

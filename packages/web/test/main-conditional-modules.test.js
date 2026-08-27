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
 * module it pulls in replaced by a recorder — what this pins is WHICH modules a
 * config loads, not what any of them then does.
 */
const assert = require('node:assert');
const { test } = require('node:test');
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
    `export const configureAnalytics = record;`,
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
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
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
 * @param {object} config - The client runtime's config blob, as main.js reads it
 * @returns {Promise<string[]>}
 */
async function boot(config, page = {}) {
  await bundleOnce();

  globalThis.__loaded = [];
  globalThis.__omegaClient = {
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

  await bundle.default({ manager: {}, options: {} });

  return globalThis.__loaded;
}

test('a config that never mentions consent still ships the banner', async () => {
  // The default-true read (#551): a client blob assembled outside loadConfig()'s
  // materialization — a test fixture, a hand-built Manager.config — carries no
  // `consent` key at all, and the schema promises the gate is ON.
  const loaded = await boot({});

  assert.ok(loaded.includes('consent.js'), `the consent gate is default-ON, so an unmentioned key loads it — loaded ${JSON.stringify(loaded)}`);
});

test('an explicit false is the only thing that drops the consent gate', async () => {
  const loaded = await boot({ consent: { enabled: false } });

  assert.ok(!loaded.includes('consent.js'), `only \`enabled: false\` turns the banner off — loaded ${JSON.stringify(loaded)}`);
});

test('the opt-in modules stay opt-in', async () => {
  // The flip is per-key, not per-loop: an absent exit-popup or social-sharing
  // section is a feature that was never configured, and turning them on for
  // every brand would be the same bug pointed the other way.
  const loaded = await boot({});

  assert.ok(!loaded.includes('exit-popup.js'), `an unconfigured exit popup stays off — loaded ${JSON.stringify(loaded)}`);
  assert.ok(!loaded.includes('social-sharing.js'), `unconfigured social sharing stays off — loaded ${JSON.stringify(loaded)}`);
});

test('a configured opt-in module still loads', async () => {
  const loaded = await boot({ exitPopup: { enabled: true }, socialSharing: { enabled: true } });

  assert.ok(loaded.includes('exit-popup.js'), `an enabled exit popup loads as before — loaded ${JSON.stringify(loaded)}`);
  assert.ok(loaded.includes('social-sharing.js'), `enabled social sharing loads as before — loaded ${JSON.stringify(loaded)}`);
});

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
test('#555: a page inside a frame loads no dev palette', async () => {
  const loaded = await boot({}, { development: true, iframed: true });

  assert.ok(!loaded.includes('dev-palette.js'), `an embedded frame gets no pull-tab — loaded ${JSON.stringify(loaded)}`);
  assert.ok(loaded.includes('dev-icon-audit.js'), `the rest of the dev lane is untouched — loaded ${JSON.stringify(loaded)}`);
});

test('#555: a normal dev page still gets the palette', async () => {
  const loaded = await boot({}, { development: true });

  assert.ok(loaded.includes('dev-palette.js'), `top-level dev pages are unchanged — loaded ${JSON.stringify(loaded)}`);
});

test('#555: production loads neither, framed or not', async () => {
  for (const iframed of [false, true]) {
    const loaded = await boot({}, { iframed });
    assert.ok(!loaded.includes('dev-palette.js'), `iframed=${iframed}: the whole dev lane is development-only`);
    assert.ok(!loaded.includes('dev-icon-audit.js'), `iframed=${iframed}: …including the icon audit`);
  }
});

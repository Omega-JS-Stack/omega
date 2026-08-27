/**
 * The site must watch @omega.js/client's dist (#378). The client is not a
 * source layer — it enters the bundle through the `@omega.js/client` esbuild
 * alias, resolved ONCE at boot (paths.js resolveClientEntry) — so the asset
 * lane's watched set (app assets, theme layers, core js/css, sections) never
 * covered it: an edit to the client rebuilt the client's own dist and stopped
 * there, and the site kept serving the bytes it bundled at boot until an
 * unrelated asset edit or a stack restart happened to rebuild.
 *
 * Two shapes, because the client's dist arrives BOTH ways: its prepare:watch
 * copies one changed file in place, and a full `npm run prepare` deletes the
 * whole dist dir and writes it again — the second is what kills a watch handle
 * keyed to the directory that went away.
 *
 * Real execution: a real fixture client dist, the real asset build behind the
 * real watcher, real esbuild output — the assertion reads the BUILT bundle for
 * bytes only the client could have contributed, polled to a deadline.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildAssets } = require('../../src/assets.js');
const { watchAssetSources } = require('../../src/commands/dev.js');

// The rebuild deadline scales with the lane's load knob (#211) and with this
// machine's measured contention (#615).
const { buildRecorder, waitForRebuild } = require('../lib/deadlines.js');
// A recursive watcher is not listening the instant it is created (the rescan
// lane pays the same settle window in live-decisions.test.js).
const SETTLE_MS = 500;

// The fixture client's entry, marked with the string the built bundle must
// carry. The marker rides a function BODY: dev builds skip minification, but
// nothing keeps an unreferenced constant alive through bundling.
const clientEntry = (marker) => [
  'export default {',
  `  initialize: async () => '${marker}',`,
  '};',
].join('\n');

// The one client subpath the boot runtime imports (runtime/boot.js).
const CLIENT_ICON_RENDERER = 'export function createIconRenderer() { return { start: () => {} }; }';

/**
 * A minimal site whose ONLY interesting input is the client: one asset layer
 * with a main.js that boots the client, and a fixture `@omega.js/client`
 * package dist the build aliases to — the client tree lives outside the target
 * root, exactly as a real (linked or installed) one does.
 */
function app(t) {
  // realpath: macOS /var/folders/… is a symlink to /private/var/…, and the
  // watcher reports resolved paths.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-client-dist-')));
  const clientRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-client-pkg-')));
  const clientDist = path.join(clientRoot, 'dist');
  const write = (base) => (rel, contents) => {
    const abs = path.join(base, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };
  const writeTarget = write(root);
  const writeClient = write(clientDist);

  writeTarget('assets/js/main.js', [
    "import omega from '@omega.js/client';",
    'export default () => omega.initialize();',
  ].join('\n'));
  // The core layer the boot runtime's dev-mode dynamic import reaches through
  // the __main_assets__ alias — a stub, since the real core lib is not what
  // this suite is about.
  writeTarget('core/js/libs/dev.js', 'export default {};');

  writeClient('index.js', clientEntry('CLIENT-BEFORE'));
  writeClient('modules/icon-renderer.js', CLIENT_ICON_RENDERER);

  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(clientRoot, { recursive: true, force: true });
  });

  return {
    assets: path.join(root, 'assets'),
    core: path.join(root, 'core'),
    out: path.join(root, '_site'),
    clientDist,
    writeClient,
  };
}

/**
 * Build the fixture's assets the way the dev loop builds them (dev mode: stable
 * names, no minify) and arm the asset lane's watchers over it.
 */
async function startWatch(t, fixture) {
  // What the watcher actually did, for a timeout's failure message (#615) —
  // here the asset build IS the rebuild, so it records itself.
  const builds = buildRecorder();
  const build = async (only) => {
    builds.onStart();
    try {
      return await buildAssets({
        layers: [fixture.assets],
        themeRoots: [],
        sectionRoots: [fixture.assets],
        themesDir: path.join(fixture.core, 'themes'),
        coreDir: fixture.core,
        outDir: fixture.out,
        clientEntry: path.join(fixture.clientDist, 'index.js'),
        dev: true,
        only,
      });
    } finally {
      builds.onFinish();
    }
  };

  await build();

  const watchers = watchAssetSources({
    dirs: [fixture.assets],
    clientDist: fixture.clientDist,
    build,
  });
  t.after(() => watchers.close());
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  // Every built js file: splitting puts the client in a SHARED chunk, so which
  // file carries its bytes is esbuild's business, not this suite's.
  const bundle = () => {
    const jsDir = path.join(fixture.out, 'assets', 'js');
    const read = (dir) => fs.readdirSync(dir, { withFileTypes: true })
      .map((entry) => (entry.isDirectory()
        ? read(path.join(dir, entry.name))
        : fs.readFileSync(path.join(dir, entry.name), 'utf8')))
      .join('\n');
    return read(jsDir);
  };

  return {
    bundle,
    bundleBecomes(pattern, message) {
      return waitForRebuild({ read: bundle, pattern, message, builds });
    },
  };
}

test('a file changed INSIDE the client dist rebuilds the site bundle', async (t) => {
  const fixture = app(t);
  const site = await startWatch(t, fixture);

  assert.match(site.bundle(), /CLIENT-BEFORE/, 'the first build bundles the client as it stands');

  // The incremental shape: the client's own prepare:watch copies one changed
  // file into the existing dist.
  fixture.writeClient('index.js', clientEntry('CLIENT-AFTER-EDIT'));
  await site.bundleBecomes(/CLIENT-AFTER-EDIT/, 'the client dist is a watched asset source — its change rebuilds the site');
});

test('a client dist DELETED and rewritten whole rebuilds the site bundle', async (t) => {
  const fixture = app(t);
  const site = await startWatch(t, fixture);

  assert.match(site.bundle(), /CLIENT-BEFORE/, 'the first build bundles the client as it stands');

  // The prepare shape: `npm run prepare` in the client wipes dist/ and writes
  // it again, so the watched root itself goes away for a stretch.
  fs.rmSync(fixture.clientDist, { recursive: true, force: true });
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  fixture.writeClient('index.js', clientEntry('CLIENT-AFTER-PREPARE'));
  fixture.writeClient('modules/icon-renderer.js', CLIENT_ICON_RENDERER);

  await site.bundleBecomes(/CLIENT-AFTER-PREPARE/, 'a replaced dist rebuilds the site — the watch re-arms onto the new directory');

  // The half a surviving-but-dead handle fails silently: the replace landed,
  // and then nothing ever again.
  fixture.writeClient('index.js', clientEntry('CLIENT-AFTER-REARM'));
  await site.bundleBecomes(/CLIENT-AFTER-REARM/, 'every later client edit lands too — the re-armed watch stayed live');
});

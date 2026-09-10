/**
 * A config reset must never restart the dev server (#206).
 *
 * Eleventy re-runs the `config:` callback on every config reset, and
 * `EleventyServe.hasOptionsChanged()` compares the resulting `serverOptions`
 * with `assert.deepStrictEqual` — where differing FUNCTION references never
 * compare equal. A freshly built middleware array therefore made every reset
 * look like a server-options change, and Eleventy answered each one with a
 * full `restart()`: dev-server close + relisten. An edit burst queues a
 * follow-up build, whose second restart re-listened on a socket the first had
 * not finished releasing — `ERR_SERVER_ALREADY_LISTEN`, process dead (it took
 * the newsflash stack down live on 2026-08-06).
 *
 * Real execution: a real temp app, a real Eleventy watcher, a real listening
 * dev server, a real edit. The assertions are the restart's own fingerprints —
 * a new dev-server instance and a `close` on the listening socket — plus an
 * HTTP GET proving the same server still answers after the reset.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { resolvePorts } = require('@omega.js/config');

const { configureOmega } = require('../../src/index.js');
const { registerTemplateWatchTargets, devServerOptions } = require('../../src/commands/dev.js');

// A rebuild is chokidar's write-settle window plus one build of this (tiny)
// fixture; the deadline is the point at which "the edit never landed" is the
// only remaining explanation. It scales with the lane's load knob (#211) and
// with this machine's measured contention (#615).
const { POLL_MS, buildRecorder, waitForRebuild } = require('../lib/deadlines.js');
// Consecutive quiet polls (no build running) that mean the watch loop is done
// — the restart, if one is coming, rides the END of the rebuild (Eleventy
// reloads the server after write), so the assertions wait for silence first.
const SETTLE_QUIET_POLLS = 20;

// Away from the classic 4000/4001 a live brand stack sits on; the allocator
// bumps from here until it finds a free one.
const TEST_PORT_BASE = 4700;

const ACTIVE_THEME = 'toy-theme';

const SITE_DATA = {
  url: 'http://localhost:4000',
  brand: { id: 'restart', name: 'RestartCo', description: 'Dev-server restart test brand' },
  meta: { title: 'RestartCo', description: 'Restart meta description' },
  theme: { id: ACTIVE_THEME },
};

/**
 * The smallest app that can carry a config RESET: one consumer layout (a
 * config-time capture, so editing it forces the reset) rendering one page,
 * over a packaged layer tree the engine can resolve. Teardown is the caller's
 * — the tree must outlive the watcher, or an in-flight rebuild writes into a
 * deleted dir.
 */
function app() {
  // realpath: the dev loop derives its paths from process.cwd(), which is the
  // RESOLVED path — on macOS /var/folders/… is a symlink to /private/var/…
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-restart-')));
  const src = path.join(root, 'src');
  const packaged = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-restart-pkg-')));
  const write = (rel, contents) => {
    const abs = path.join(src, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };

  write('_layouts/toy.html', '<main data-layout="BEFORE">{{ content }}</main>');
  write('pages/index.html', ['---', 'layout: toy.html', 'permalink: /', '---', '<p>home</p>'].join('\n'));

  // The packaged layers the engine walks: the active theme, the base theme
  // every chain ends at, and the sample-content sets.
  for (const dir of [
    path.join(packaged, 'core', '_layouts'),
    path.join(packaged, 'themes', ACTIVE_THEME),
    path.join(packaged, 'themes', 'classy'),
    ...['sample-posts', 'sample-team', 'sample-updates'].map((set) => path.join(packaged, 'defaults', set)),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const cwd = process.cwd();
  process.chdir(root);

  return {
    src,
    out: path.join(root, 'dist'),
    themesDir: path.join(packaged, 'themes'),
    coreDir: path.join(packaged, 'core'),
    defaultsDir: path.join(packaged, 'defaults'),
    write,
    cleanup: () => {
      process.chdir(cwd);
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(packaged, { recursive: true, force: true });
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the dev loop's Eleventy the way `omega dev` wires it — the same
 * `config:` callback (server options + the derived watch registration + the
 * engine), one long-lived instance, a real watcher and a REAL listening
 * server.
 */
async function startDevServer(t, fixture) {
  const Eleventy = require('@11ty/eleventy').default;
  const { ports } = await resolvePorts({ wanted: { website: TEST_PORT_BASE } });
  // Eleventy re-runs the config callback ONLY on a config reset — counting the
  // runs is how a reset is told apart from an incremental rebuild.
  const configRuns = { count: 0 };
  // What the watcher actually did, for a timeout's failure message (#615).
  const builds = buildRecorder();
  const elev = new Eleventy(fixture.src, fixture.out, {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      configRuns.count += 1;
      eleventyConfig.on('eleventy.before', builds.onStart);
      eleventyConfig.on('eleventy.after', builds.onFinish);
      eleventyConfig.setServerOptions(devServerOptions(fixture.out));
      registerTemplateWatchTargets(eleventyConfig, { onRescans: () => {} });
      return configureOmega(eleventyConfig, {
        consumerDir: fixture.src,
        siteData: SITE_DATA,
        activeTheme: ACTIVE_THEME,
        themesDir: fixture.themesDir,
        coreDir: fixture.coreDir,
        defaultsDir: fixture.defaultsDir,
        environment: 'development',
        assetManifest: {
          js: { main: '/assets/js/main-TEST.js', pages: {} },
          css: { main: '/assets/css/main-TEST.css', pages: {}, layouts: {} },
        },
      });
    },
  });

  await elev.init();
  await elev.watch();
  await elev.serve(ports.website);
  await elev.eleventyServe._server.ready();

  t.after(async () => {
    await elev.stopWatch();
    fixture.cleanup();
  });

  const page = () => fs.readFileSync(path.join(fixture.out, 'index.html'), 'utf8');

  return {
    port: ports.website,
    configRuns,
    serve: elev.eleventyServe,
    page,
    /** Wait for the rebuild to land, then for the watch loop to go quiet. */
    async settleAfter(pattern) {
      await waitForRebuild({ read: page, pattern, message: 'the edit landed in the rendered page', builds });

      for (let quiet = 0; quiet < SETTLE_QUIET_POLLS;) {
        await sleep(POLL_MS);
        quiet = elev.watchManager.isBuildRunning() ? 0 : quiet + 1;
      }
    },
  };
}

test('the dev-server options are ONE object for the session', () => {
  const first = devServerOptions('/tmp/site-out', 9099);

  // assert.ok, not assert.equal: a failure here prints the message, not two
  // dumps of an options object whose diff is every middleware closure.
  assert.ok(
    devServerOptions('/tmp/site-out', 9099) === first,
    'every config reset must hand Eleventy the identical options object — a rebuilt one carries fresh middleware closures, which deepStrictEqual can only read as "changed"',
  );

  // The live auth-port getter is what `omega dev` actually passes (#300), and a
  // config reset re-evaluates the callback that closes over it — two DISTINCT
  // getter identities must still resolve to the one cached object
  const live = devServerOptions('/tmp/site-out-live', () => 9099);
  assert.ok(
    devServerOptions('/tmp/site-out-live', () => 9200) === live,
    'a getter keys as `live`, so its identity can never restart the server',
  );

  // The dev-chrome getter the serve-time ports injection rides (#346) is the
  // second one `omega dev` passes, and it keys exactly the same way
  const injecting = devServerOptions('/tmp/site-out-inject', () => 9099, () => ({ ports: { auth: 9099 } }));
  assert.ok(
    devServerOptions('/tmp/site-out-inject', () => 9200, () => ({ ports: { auth: 9200 } })) === injecting,
    'the injecting server is one object for the session too',
  );
});

test('a config reset does not restart the dev server', async (t) => {
  const fixture = app();
  const dev = await startDevServer(t, fixture);

  const devServer = dev.serve._server;
  const socket = devServer._server;
  let closes = 0;
  socket.on('close', () => { closes += 1; });

  assert.equal((await fetch(`http://localhost:${dev.port}/`)).status, 200, 'the server answers before the reset');

  // The consumer layout is a config-time capture, so an edit here rides the
  // reset lane (dev-watch.test.js proves the reset itself).
  const runsBeforeEdit = dev.configRuns.count;
  fixture.write('_layouts/toy.html', '<main data-layout="AFTER">{{ content }}</main>');
  await dev.settleAfter(/data-layout="AFTER"/);

  // EVENT-keyed, not count-keyed (#344). This asserts the edit rode the RESET
  // lane, which is what makes every assertion below mean anything — but never
  // how MANY resets it took. One save legitimately reaches chokidar once per
  // registered path form (src/commands/dev.js registers two for a cwd-
  // contained dir, on purpose and measured), and whether those events land in
  // one throttle window or two is the machine's load, not the product: 3 !== 2
  // was this suite's most frequent lane-only failure. The product promise is
  // the four assertions below, and they hold PER reset — with two resets,
  // `closes === 0` is a stronger statement, not a weaker one.
  assert.ok(dev.configRuns.count > runsBeforeEdit,
    `the edit rode the config-reset lane — the config callback re-ran (was ${runsBeforeEdit}, now ${dev.configRuns.count})`);
  // assert.ok again: the instances differ by their whole socket state, and the
  // diff of two dev servers buries the one fact that matters.
  assert.ok(dev.serve._server === devServer, 'the SAME dev server survived the reset — a restart builds a new instance');
  assert.equal(closes, 0, 'the listening socket was never closed — a restart closes it before relistening');
  assert.equal(dev.serve.hasOptionsChanged(), false, 'the server options read as unchanged across the reset');
  assert.equal((await fetch(`http://localhost:${dev.port}/`)).status, 200, 'the same server still answers after the reset');
});

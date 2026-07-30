/**
 * `omega dev`'s watch rebuild must serve what was just written (#49). The dev
 * loop keeps ONE Eleventy instance alive, and Eleventy only re-runs the config
 * callback when a changed file triggers a config reset — so layout content
 * (captured at config time by the virtual-template registration) and the
 * json-in-_includes data system (read at config time into site.data._includes)
 * both go stale on an edit: the rebuild logs "Wrote N files" and serves the
 * PREVIOUS render until the server is restarted.
 *
 * Real execution: a real temp app, a real Eleventy watcher, real file edits,
 * real written output — no mocks and no sleeps; the assertions poll the
 * written page until the rebuild lands, deadlined.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { configureOmega } = require('../src/index.js');
const { registerTemplateWatchTargets } = require('../src/commands/dev.js');

// A rebuild is chokidar's write-settle window (150ms) plus one build of the
// fixture; the deadline is the point at which "the edit never landed" is the
// only remaining explanation.
const REBUILD_DEADLINE_MS = 30000;
const POLL_MS = 50;
// Consecutive quiet polls (no build running) that mean the watch loop is done.
const DRAIN_QUIET_POLLS = 20;

const SITE_DATA = {
  url: 'http://localhost:4000',
  brand: { id: 'watch', name: 'WatchCo', description: 'Watch-loop test brand' },
  meta: { title: 'WatchCo', description: 'Watch meta description' },
  theme: { id: 'classy' },
};

// A minimal consumer app: its own _layouts winner, a json-in-_includes data
// file, and one page that renders both. Teardown is the caller's (startWatch's)
// — the tree must outlive the watcher, or an in-flight rebuild writes into a
// deleted dir.
function app() {
  // realpath: the dev loop derives its paths from process.cwd(), which is the
  // RESOLVED path — on macOS /var/folders/… is a symlink to /private/var/…
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-watch-')));
  const src = path.join(root, 'src');
  const write = (rel, contents) => {
    const abs = path.join(src, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };

  write('_layouts/toy.html', '<main data-layout="BEFORE">{{ content }}</main>');
  write('_includes/nav.json', '{ label: "BEFORE" }');
  write('pages/index.html', [
    '---',
    'layout: toy.html',
    'permalink: /',
    '---',
    '<p data-nav="{{ site.data._includes.nav.label }}">home</p>',
  ].join('\n'));

  const cwd = process.cwd();
  process.chdir(root);

  return {
    root,
    src,
    out: path.join(root, 'dist'),
    write,
    cleanup: () => {
      process.chdir(cwd);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Start the dev loop's Eleventy the way `omega dev` wires it (one long-lived
 * instance, real watcher, no server) and hand back a reader that WAITS for the
 * rendered page to carry an expected marker. The watcher drives the rebuild —
 * exactly the path a hand edit takes — so the wait is a poll of the written
 * output, deadlined: green resolves as soon as the rebuild lands, a rebuild
 * that serves the stale capture fails at the deadline.
 */
async function startWatch(t, fixture) {
  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(fixture.src, fixture.out, {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      registerTemplateWatchTargets(eleventyConfig, fixture.src);
      return configureOmega(eleventyConfig, {
        consumerDir: fixture.src,
        siteData: SITE_DATA,
        environment: 'development',
        assetManifest: {
          js: { main: '/assets/js/main-TEST.js', pages: {} },
          css: { main: '/assets/css/main-TEST.css', pages: {}, themePages: {} },
        },
      });
    },
  });

  await elev.init();
  await elev.watch();
  t.after(async () => {
    await elev.stopWatch();
    // The page poll returns on the marker while the rest of the pages are
    // still being written (and one more rebuild may be queued behind it) —
    // the tree may only go away once the loop has been QUIET for a stretch,
    // or the drained writes land in a deleted dir.
    for (let quiet = 0; quiet < DRAIN_QUIET_POLLS;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      quiet = elev.watchManager.isBuildRunning() ? 0 : quiet + 1;
    }
    fixture.cleanup();
  });

  const page = () => fs.readFileSync(path.join(fixture.out, 'index.html'), 'utf8');

  return {
    page,
    async pageBecomes(pattern, message) {
      const deadline = Date.now() + REBUILD_DEADLINE_MS;
      let rendered = page();

      while (!pattern.test(rendered) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        rendered = page();
      }

      assert.match(rendered, pattern, message);
    },
  };
}

test('a watched _layouts edit is served by the very next rebuild', async (t) => {
  const fixture = app();
  const watch = await startWatch(t, fixture);

  assert.match(watch.page(), /data-layout="BEFORE"/, 'the first build renders the authored layout');

  fixture.write('_layouts/toy.html', '<main data-layout="AFTER">{{ content }}</main>');
  await watch.pageBecomes(/data-layout="AFTER"/, 'the rebuild serves the edit, not the config-time capture');

  // A second edit proves the loop keeps invalidating — the reset rebuilds the
  // config, and the NEXT edit must reset the rebuilt one too.
  fixture.write('_layouts/toy.html', '<main data-layout="AGAIN">{{ content }}</main>');
  await watch.pageBecomes(/data-layout="AGAIN"/, 'every later edit lands too');
});

test('a watched _includes json edit is served by the very next rebuild', async (t) => {
  const fixture = app();
  const watch = await startWatch(t, fixture);

  assert.match(watch.page(), /data-nav="BEFORE"/, 'the first build renders the authored data file');

  fixture.write('_includes/nav.json', '{ label: "AFTER" }');
  await watch.pageBecomes(/data-nav="AFTER"/, 'site.data._includes is recomposed on the rebuild');

  fixture.write('_includes/nav.json', '{ label: "AGAIN" }');
  await watch.pageBecomes(/data-nav="AGAIN"/, 'every later edit lands too');
});

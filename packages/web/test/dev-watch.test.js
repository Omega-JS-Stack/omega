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
// only remaining explanation. It scales with the lane's load knob (#211).
const REBUILD_DEADLINE_MS = require('./lib/deadlines.js').rebuildDeadlineMs();
const POLL_MS = 50;
// Consecutive quiet polls (no build running) that mean the watch loop is done.
const DRAIN_QUIET_POLLS = 20;

const ACTIVE_THEME = 'toy-theme';

const SITE_DATA = {
  url: 'http://localhost:4000',
  brand: { id: 'watch', name: 'WatchCo', description: 'Watch-loop test brand' },
  meta: { title: 'WatchCo', description: 'Watch meta description' },
  theme: { id: ACTIVE_THEME },
};

// A minimal consumer app carrying EVERY layer of the layout chain (#134): its
// own _layouts winner, a json-in-_includes data file, a consumer-local theme
// layer, and a packaged layer reached the way a linked brand reaches it — a
// `node_modules/@omega.js/web` symlink over the real framework tree. One page
// per layer renders that layer's layout. Teardown is the caller's
// (startWatch's) — the tree must outlive the watcher, or an in-flight rebuild
// writes into a deleted dir.
function app() {
  // realpath: the dev loop derives its paths from process.cwd(), which is the
  // RESOLVED path — on macOS /var/folders/… is a symlink to /private/var/…
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-watch-')));
  const src = path.join(root, 'src');
  // The packaged tree lives OUTSIDE the app root — in a real linked brand the
  // symlink resolves to the monorepo, far outside cwd, and an escaping `../`
  // relative watch target makes Eleventy re-root its watcher and drop EVERY
  // reset (#134 verification). In-root would hide that regression.
  const packaged = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-pkg-')));
  const writer = (base) => (rel, contents) => {
    const abs = path.join(base, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };
  const write = writer(src);
  const writePackaged = writer(packaged);
  const page = (layout, permalink, body) => [
    '---',
    `layout: ${layout}`,
    `permalink: ${permalink}`,
    '---',
    body,
  ].join('\n');

  write('_layouts/toy.html', '<main data-layout="BEFORE">{{ content }}</main>');
  write('_includes/nav.json', '{ label: "BEFORE" }');
  write(`themes/${ACTIVE_THEME}/_layouts/theme-toy.html`, '<main data-theme-layout="BEFORE">{{ content }}</main>');
  writePackaged('core/_layouts/core-toy.html', '<main data-core-layout="BEFORE">{{ content }}</main>');
  // The base theme layer of every chain — present, empty, exactly as a theme
  // that ships no layouts is.
  fs.mkdirSync(path.join(packaged, 'themes', 'classy'), { recursive: true });
  for (const set of ['sample-posts', 'sample-team', 'sample-updates']) {
    fs.mkdirSync(path.join(packaged, 'defaults', set), { recursive: true });
  }
  // Packaged default pages + showcase pages (#136): layout-less, because the
  // real ones render against the real core layouts, which this fixture
  // replaces. Both are read at CONFIG time and registered as virtual
  // templates, so an edit only lands through a config reset.
  const defaultPage = (permalink, marker, body) => [
    '---',
    `permalink: ${permalink}`,
    '---',
    `<p ${marker}="BEFORE">${body}</p>`,
  ].join('\n');
  writePackaged('defaults/pages/default-toy.html', defaultPage('/default-page.html', 'data-default', 'default'));
  writePackaged('defaults/showcase/showcase-toy.html', defaultPage('/showcase-page.html', 'data-showcase', 'showcase'));

  // A consumer-local section: its template AND its json5 defaults are read
  // once per config registration (sections.js entry/template caches), so both
  // are config-time captures like the layouts.
  write('_sections/toy-section/section.html', '<section data-section="{{ args.label }}">toy</section>');
  write('_sections/toy-section/section.json5', '{ defaults: { label: "BEFORE" } }');

  // The active theme layer's first-paint faces: engine.js readdir's the first
  // theme layer WITH a fonts/ dir once per config registration
  // (site.fontPreloads), so a face added mid-session only lands through a
  // reset. The page emits the same loop core/_includes/core/head.html does —
  // the real chrome this fixture's toy layouts replace.
  write(`themes/${ACTIVE_THEME}/fonts/aaa-400-normal-latin.woff2`, 'face');
  write('pages/fonts-page.html', [
    '---',
    'permalink: /fonts-page.html',
    '---',
    '{% for font in site.fontPreloads %}<link rel="preload" href="{{ font }}"/>{% endfor %}',
  ].join('\n'));

  write('pages/index.html', page('toy.html', '/', '<p data-nav="{{ site.data._includes.nav.label }}">home</p>'));
  write('pages/section-page.html', page('toy.html', '/section-page.html', '{% section "toy-section" %}'));
  write('pages/theme-page.html', page('theme-toy.html', '/theme-page.html', '<p>theme</p>'));
  write('pages/core-page.html', page('core-toy.html', '/core-page.html', '<p data-page="BEFORE">core</p>'));

  // The linked-brand shape: the framework is reached through node_modules,
  // whose subtree Eleventy's watcher ignores wholesale.
  const linked = path.join(root, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.symlinkSync(packaged, linked);

  const cwd = process.cwd();
  process.chdir(root);

  return {
    root,
    src,
    out: path.join(root, 'dist'),
    themesDir: path.join(linked, 'themes'),
    coreDir: path.join(linked, 'core'),
    defaultsDir: path.join(linked, 'defaults'),
    write,
    writePackaged,
    cleanup: () => {
      process.chdir(cwd);
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(packaged, { recursive: true, force: true });
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
  // Eleventy re-runs the config callback ONLY on a config reset — counting
  // the runs is how a reset is told apart from an incremental rebuild.
  const configRuns = { count: 0 };
  const elev = new Eleventy(fixture.src, fixture.out, {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      configRuns.count += 1;
      registerTemplateWatchTargets(eleventyConfig, {
        consumerDir: fixture.src,
        activeTheme: ACTIVE_THEME,
        themesDir: fixture.themesDir,
        coreDir: fixture.coreDir,
        defaultsDir: fixture.defaultsDir,
      });
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

  const page = (file = 'index.html') => fs.readFileSync(path.join(fixture.out, file), 'utf8');

  return {
    page,
    configRuns,
    async pageBecomes(pattern, message, file) {
      const deadline = Date.now() + REBUILD_DEADLINE_MS;
      let rendered = page(file);

      while (!pattern.test(rendered) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        rendered = page(file);
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

test('a watched theme-layer _layouts edit is served by the very next rebuild', async (t) => {
  const fixture = app();
  const watch = await startWatch(t, fixture);

  assert.match(watch.page('theme-page.html'), /data-theme-layout="BEFORE"/, 'the first build renders the theme layer\'s layout');

  fixture.write(`themes/${ACTIVE_THEME}/_layouts/theme-toy.html`, '<main data-theme-layout="AFTER">{{ content }}</main>');
  await watch.pageBecomes(/data-theme-layout="AFTER"/, 'the rebuild serves the theme-layer edit', 'theme-page.html');

  fixture.write(`themes/${ACTIVE_THEME}/_layouts/theme-toy.html`, '<main data-theme-layout="AGAIN">{{ content }}</main>');
  await watch.pageBecomes(/data-theme-layout="AGAIN"/, 'every later edit lands too', 'theme-page.html');
});

test('a watched packaged-layer _layouts edit is served by the very next rebuild', async (t) => {
  const fixture = app();
  const watch = await startWatch(t, fixture);

  assert.match(watch.page('core-page.html'), /data-core-layout="BEFORE"/, 'the first build renders the core layer\'s layout');

  fixture.writePackaged('core/_layouts/core-toy.html', '<main data-core-layout="AFTER">{{ content }}</main>');
  await watch.pageBecomes(/data-core-layout="AFTER"/, 'the rebuild serves the packaged-layer edit — the node_modules ignore does not swallow it', 'core-page.html');

  fixture.writePackaged('core/_layouts/core-toy.html', '<main data-core-layout="AGAIN">{{ content }}</main>');
  await watch.pageBecomes(/data-core-layout="AGAIN"/, 'every later edit lands too', 'core-page.html');
});

test('a watched defaults/pages edit is served by the very next rebuild', async (t) => {
  const fixture = app();
  const watch = await startWatch(t, fixture);

  assert.match(watch.page('default-page.html'), /data-default="BEFORE"/, 'the first build renders the packaged default page');

  fixture.writePackaged('defaults/pages/default-toy.html', '---\npermalink: /default-page.html\n---\n<p data-default="AFTER">default</p>');
  await watch.pageBecomes(/data-default="AFTER"/, 'the rebuild serves the defaults edit, not the config-time capture', 'default-page.html');

  fixture.writePackaged('defaults/pages/default-toy.html', '---\npermalink: /default-page.html\n---\n<p data-default="AGAIN">default</p>');
  await watch.pageBecomes(/data-default="AGAIN"/, 'every later edit lands too', 'default-page.html');
});

test('a watched defaults/showcase edit is served by the very next rebuild', async (t) => {
  const fixture = app();
  const watch = await startWatch(t, fixture);

  assert.match(watch.page('showcase-page.html'), /data-showcase="BEFORE"/, 'the first build renders the packaged showcase page');

  fixture.writePackaged('defaults/showcase/showcase-toy.html', '---\npermalink: /showcase-page.html\n---\n<p data-showcase="AFTER">showcase</p>');
  await watch.pageBecomes(/data-showcase="AFTER"/, 'the rebuild serves the showcase edit, not the config-time capture', 'showcase-page.html');

  fixture.writePackaged('defaults/showcase/showcase-toy.html', '---\npermalink: /showcase-page.html\n---\n<p data-showcase="AGAIN">showcase</p>');
  await watch.pageBecomes(/data-showcase="AGAIN"/, 'every later edit lands too', 'showcase-page.html');
});

test('a watched _sections edit is served by the very next rebuild', async (t) => {
  const fixture = app();
  const watch = await startWatch(t, fixture);

  assert.match(watch.page('section-page.html'), /data-section="BEFORE"/, 'the first build renders the authored section');

  fixture.write('_sections/toy-section/section.html', '<section data-section="AFTER-{{ args.label }}">toy</section>');
  await watch.pageBecomes(/data-section="AFTER-BEFORE"/, 'the rebuild serves the section template edit, not the cached parse', 'section-page.html');

  fixture.write('_sections/toy-section/section.json5', '{ defaults: { label: "AFTER" } }');
  await watch.pageBecomes(/data-section="AFTER-AFTER"/, 'the section defaults are re-read too', 'section-page.html');
});

test('a watched theme-layer fonts edit is served by the very next rebuild', async (t) => {
  const fixture = app();
  const watch = await startWatch(t, fixture);

  assert.match(watch.page('fonts-page.html'), /"\/assets\/fonts\/aaa-400-normal-latin\.woff2"/, 'the first build preloads the authored face');

  fixture.write(`themes/${ACTIVE_THEME}/fonts/mmm-400-normal-latin.woff2`, 'face');
  await watch.pageBecomes(/"\/assets\/fonts\/mmm-400-normal-latin\.woff2"/, 'the rebuild re-reads the fonts dir, not the config-time capture', 'fonts-page.html');

  fixture.write(`themes/${ACTIVE_THEME}/fonts/zzz-400-normal-latin.woff2`, 'face');
  await watch.pageBecomes(/"\/assets\/fonts\/zzz-400-normal-latin\.woff2"/, 'every later face lands too', 'fonts-page.html');
});

test('an ordinary page edit rebuilds incrementally — no config reset', async (t) => {
  const fixture = app();
  const watch = await startWatch(t, fixture);

  const runsAfterFirstBuild = watch.configRuns.count;

  fixture.write('pages/core-page.html', [
    '---',
    'layout: core-toy.html',
    'permalink: /core-page.html',
    '---',
    '<p data-page="AFTER">core</p>',
  ].join('\n'));
  await watch.pageBecomes(/data-page="AFTER"/, 'the page edit lands', 'core-page.html');

  assert.equal(watch.configRuns.count, runsAfterFirstBuild, 'a content edit never re-runs the config — page edits stay on the incremental path');

  // The contrast: a layout edit DOES reset, so the counter is a real signal
  // and not a constant.
  fixture.write('_layouts/toy.html', '<main data-layout="AFTER">{{ content }}</main>');
  await watch.pageBecomes(/data-layout="AFTER"/, 'the layout edit lands');
  assert.ok(watch.configRuns.count > runsAfterFirstBuild, 'a layout edit re-runs the config (the reset)');
});

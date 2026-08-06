/**
 * The rescan lane end to end (#200 Lane B). Two halves:
 *
 *  1. `watchRescanTargets` — the dev loop's light fs.watch over the recorded
 *     rescan union. A file lands, the affected capture re-runs, nothing resets.
 *  2. The live gate through a REAL Eleventy watch: a brand writes its first
 *     real post and the sample corpus steps aside on the next rebuild —
 *     without a config reset, which is the incremental contract
 *     (dev-watch.test.js) this lane exists to protect.
 *
 * Real files, a real watcher, real written output — the ordering between the
 * user's file event and Eleventy's own rebuild is the whole point, and a mock
 * would decide it for us.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { configureOmega } = require('../src/index.js');
const { registerTemplateWatchTargets, watchRescanTargets } = require('../src/commands/dev.js');

const REBUILD_DEADLINE_MS = 30000;
const POLL_MS = 50;
const DRAIN_QUIET_POLLS = 20;

const ACTIVE_THEME = 'toy-theme';

const SITE_DATA = {
  url: 'http://localhost:4000',
  brand: { id: 'live', name: 'LiveCo' },
  meta: { title: 'LiveCo', description: 'Live decisions test brand' },
  theme: { id: ACTIVE_THEME },
};

test('the rescan watcher re-runs the affected capture when its dir changes', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-rescan-')));
  fs.mkdirSync(path.join(root, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(root, '_team'), { recursive: true });
  const runs = { pages: 0, team: 0 };
  const watchers = watchRescanTargets([
    { dir: path.join(root, 'pages'), kind: 'rescan', rerun: () => { runs.pages += 1; } },
    { dir: path.join(root, '_team'), kind: 'rescan', rerun: () => { runs.team += 1; } },
  ]);
  t.after(() => {
    watchers.forEach((watcher) => watcher.close());
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Arming a recursive watcher costs one platform event on macOS (a `change`
  // on the dir itself), so the baseline is whatever the watchers have settled
  // at — the DELTA is what the file edit caused.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const baseline = { ...runs };

  fs.writeFileSync(path.join(root, 'pages', 'about.md'), '---\npermalink: /about\n---\nabout');

  const deadline = Date.now() + REBUILD_DEADLINE_MS;
  while (runs.pages === baseline.pages && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  assert.equal(runs.pages, baseline.pages + 1, 'the pages capture re-ran');
  assert.equal(runs.team, baseline.team, 'only the AFFECTED scan re-runs — a rescan is not a rebuild of everything');
});

test('closing a watcher cancels the rescan it had queued', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-rescan-')));
  fs.mkdirSync(path.join(root, 'pages'), { recursive: true });
  const runs = { pages: 0 };
  const watchers = watchRescanTargets([
    { dir: path.join(root, 'pages'), kind: 'rescan', rerun: () => { runs.pages += 1; } },
  ]);
  t.after(() => {
    watchers.forEach((watcher) => watcher.close());
    fs.rmSync(root, { recursive: true, force: true });
  });

  // A bare probe over the same dir, armed AFTER the rescan watcher: one file
  // event reaches every handle on the dir in arming order, so the probe firing
  // says the rescan watcher has already queued its debounced re-run. Both are
  // armed before the settle window — a recursive watcher is not listening the
  // instant it is created.
  let events = 0;
  const probe = fs.watch(path.join(root, 'pages'), { recursive: true }, () => { events += 1; });
  t.after(() => probe.close());

  await new Promise((resolve) => setTimeout(resolve, 500));
  const baseline = runs.pages;
  const seen = events;

  fs.writeFileSync(path.join(root, 'pages', 'about.md'), '---\npermalink: /about\n---\nabout');
  const deadline = Date.now() + REBUILD_DEADLINE_MS;
  while (events === seen && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.notEqual(events, seen, 'the write reached the watchers');

  // The dev loop closes these on every config reset and reopens the new union
  // (src/commands/dev.js). A queued re-run surviving the close would fire a
  // capture belonging to a config build that no longer exists.
  watchers.forEach((watcher) => watcher.close());

  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(runs.pages, baseline, 'a closed watcher never re-runs an orphaned capture');
});

test('a missing rescan dir is skipped, not fatal', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-rescan-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const watchers = watchRescanTargets([
    { dir: path.join(root, '_posts'), kind: 'rescan', rerun: () => {} },
  ]);

  assert.deepEqual(watchers, [],
    'a collection dir the brand has not authored yet arms nothing here — Eleventy sees it appear under its input dir and rebuilds');
});

// A content-less brand: the sample corpus renders, and pages/ + the collection
// dirs are the rescan lane. The packaged tree sits OUTSIDE the app root and is
// reached through a node_modules symlink, the way a linked brand reaches it.
function app() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-live-')));
  const packaged = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-live-pkg-')));
  const src = path.join(root, 'src');
  const writer = (base) => (rel, contents) => {
    const abs = path.join(base, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };
  const write = writer(src);
  const writePackaged = writer(packaged);

  // The blog listing IS the assertion surface: which posts a build ships is
  // the sample gate's whole product.
  write('pages/blog.html', [
    '---',
    'permalink: /blog.html',
    '---',
    '{% for post in collections.posts %}<p data-post="{{ post.data.title }}"></p>{% endfor %}',
  ].join('\n'));

  fs.mkdirSync(path.join(packaged, 'themes', 'classy'), { recursive: true });
  fs.mkdirSync(path.join(packaged, 'defaults', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(packaged, 'defaults', 'showcase'), { recursive: true });
  for (const set of ['sample-team', 'sample-updates']) {
    fs.mkdirSync(path.join(packaged, 'defaults', set), { recursive: true });
  }
  writePackaged('defaults/sample-posts/2026-07-18-sample.md', [
    '---',
    'title: Sample Post',
    'tags: posts',
    '---',
    'sample body',
  ].join('\n'));

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
    cleanup: () => {
      process.chdir(cwd);
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(packaged, { recursive: true, force: true });
    },
  };
}

async function startWatch(t, fixture) {
  const Eleventy = require('@11ty/eleventy').default;
  const configRuns = { count: 0 };
  const watchers = [];
  const elev = new Eleventy(fixture.src, fixture.out, {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      configRuns.count += 1;
      registerTemplateWatchTargets(eleventyConfig, {
        onRescans: (targets) => watchers.push(...watchRescanTargets(targets)),
      });
      return configureOmega(eleventyConfig, {
        consumerDir: fixture.src,
        siteData: SITE_DATA,
        activeTheme: ACTIVE_THEME,
        themesDir: fixture.themesDir,
        coreDir: fixture.coreDir,
        defaultsDir: fixture.defaultsDir,
        environment: 'development',
        sampleAnchor: '2026-07-18',
        assetManifest: { js: { pages: {} }, css: { pages: {}, themePages: {} } },
      });
    },
  });

  await elev.init();
  await elev.watch();
  t.after(async () => {
    await elev.stopWatch();
    watchers.forEach((watcher) => watcher.close());
    for (let quiet = 0; quiet < DRAIN_QUIET_POLLS;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      quiet = elev.watchManager.isBuildRunning() ? 0 : quiet + 1;
    }
    fixture.cleanup();
  });

  const page = (file = 'blog.html') => fs.readFileSync(path.join(fixture.out, file), 'utf8');

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

test('the first real post ends the samples on the next rebuild — no config reset', async (t) => {
  const fixture = app();
  const watch = await startWatch(t, fixture);

  assert.match(watch.page(), /data-post="Sample Post"/, 'a content-less brand blogs the sample corpus');
  const runsAfterFirstBuild = watch.configRuns.count;

  fixture.write('_posts/2026-07-20-first.md', '---\ntitle: My First Post\ntags: posts\n---\nreal words');
  await watch.pageBecomes(/data-post="My First Post"/, 'the real post lands');

  assert.doesNotMatch(watch.page(), /data-post="Sample Post"/,
    'the sample corpus steps aside the moment the brand owns the collection — the gate is asked at render time');
  assert.equal(watch.configRuns.count, runsAfterFirstBuild,
    'the rescan lane NEVER resets the config — content edits stay on the incremental path');
});

/**
 * The LIVE decisions object (#200 Lane B): the scans whose product gates
 * per-page decisions — which framework default pages the consumer took over,
 * which collections the brand owns — are rescan captures, so the answer is a
 * live value the render asks for, never a value baked into the Eleventy
 * config. This suite pins the object itself: the captures re-scan, the gates
 * follow, and the collision diagnostic is loud in dev and fatal in a
 * production build.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const reads = require('@omega.js/devkit/reads');
const { createDecisions } = require('../src/decisions.js');

// A consumer tree ({ 'relative/path': contents }) inside an open capture scope
// — the shape configureOmega builds these in.
function consumer(t, files, options) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-decisions-')));
  t.after(() => {
    reads.closeScope();
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }

  reads.openScope({ consumerDir: root });
  const logged = [];
  const decisions = createDecisions({
    consumerDir: root,
    collectionDirs: ['_posts'],
    environment: (options && options.environment) || 'development',
    log: (message) => logged.push(message),
  });
  return { root, decisions, logged, write: (rel, contents) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  } };
}

test('the consumer scan is a rescan capture, never a config-reset target', (t) => {
  const app = consumer(t, { 'pages/about.md': '---\npermalink: /about\n---\nabout' });

  assert.deepEqual(reads.recordedTargets(), [],
    'a reset target here would rebuild the whole config on every page edit');
  assert.deepEqual(reads.rescanTargets().map((target) => target.dir).sort(),
    [path.join(app.root, '_posts'), path.join(app.root, 'pages')],
    'both scans arm, including the collection dir the brand has not authored yet');
});

test('re-running the pages capture updates the suppression answer', (t) => {
  const app = consumer(t, { 'pages/index.md': '---\npermalink: /\n---\nhome' });
  const pagesTarget = reads.rescanTargets().find((target) => target.dir.endsWith('pages'));

  assert.equal(app.decisions.suppresses('/about'), false);
  app.write('pages/about.md', '---\npermalink: /about\n---\nabout');
  pagesTarget.rerun();

  assert.equal(app.decisions.suppresses('/about'), true,
    'the new page takes the URL over — the framework default steps aside on the next render');
});

test('re-running the collection capture flips the own-content answer', (t) => {
  const app = consumer(t, { 'pages/index.md': '---\npermalink: /\n---\nhome' });
  const postsTarget = reads.rescanTargets().find((target) => target.dir.endsWith('_posts'));

  assert.equal(app.decisions.hasOwn('_posts'), false, 'a content-less brand gets the sample corpus');
  app.write('_posts/2026-01-01-hello.md', '---\ntitle: Hello\n---\nhello');
  postsTarget.rerun();

  assert.equal(app.decisions.hasOwn('_posts'), true, 'the first real post ends the samples');
});

test('refresh re-runs every capture at once', (t) => {
  const app = consumer(t, { 'pages/index.md': '---\npermalink: /\n---\nhome' });

  app.write('pages/about.md', '---\npermalink: /about\n---\nabout');
  app.write('_posts/2026-01-01-hello.md', '---\ntitle: Hello\n---\nhello');
  app.decisions.refresh();

  assert.equal(app.decisions.suppresses('/about'), true);
  assert.equal(app.decisions.hasOwn('_posts'), true);
});

test('a consumer-vs-consumer collision is reported loudly in dev', (t) => {
  const app = consumer(t, {
    'pages/about.md': '---\npermalink: /about\n---\nabout',
    'pages/company/about.md': '---\npermalink: /about.html\n---\nabout',
  });
  app.decisions.framework([]);

  assert.equal(app.logged.length, 1, 'one collision, one diagnostic');
  assert.match(app.logged[0], /Permalink collision at \/about/);
  assert.match(app.logged[0], /pages\/about\.md/);
  assert.match(app.logged[0], /pages\/company\/about\.md/);
});

test('a consumer page overriding a default page is never reported', (t) => {
  const app = consumer(t, { 'pages/about.md': '---\npermalink: /about\n---\nabout' });
  app.decisions.framework([{ label: 'defaults/pages/about.md', url: '/about' }]);

  assert.deepEqual(app.logged, [], 'suppression IS the override — warning about it would train the brand to ignore the log');
  assert.deepEqual(app.decisions.suppressedUrls(), ['/about']);
});

test('a consumer page landing on a default page URL by a different spelling is reported', (t) => {
  const app = consumer(t, { 'pages/about.md': '---\npermalink: /about\n---\nabout' });
  app.decisions.framework([{ label: 'defaults/pages/about.md', url: '/about.html' }]);

  assert.equal(app.logged.length, 1);
  assert.match(app.logged[0], /Permalink collision at \/about/);
  assert.match(app.logged[0], /defaults\/pages\/about\.md/);
  assert.match(app.logged[0], /exact/, 'the fix is the exact permalink — that is what suppresses the default page');
});

test('the diagnostic re-emits on every rescan while the collision persists', (t) => {
  const app = consumer(t, { 'pages/about.md': '---\npermalink: /about\n---\nabout' });
  app.decisions.framework([]);
  assert.deepEqual(app.logged, []);

  app.write('pages/company/about.md', '---\npermalink: /about.html\n---\nabout');
  reads.rescanTargets().find((target) => target.dir.endsWith('pages')).rerun();
  assert.equal(app.logged.length, 1, 'the rescan finds it');

  app.decisions.refresh();
  assert.equal(app.logged.length, 2, 'still colliding, still loud — a fixed collision simply stops emitting');
});

test('a production build fails on a collision', (t) => {
  const app = consumer(t, {
    'pages/about.md': '---\npermalink: /about\n---\nabout',
    'pages/company/about.md': '---\npermalink: /about/\n---\nabout',
  }, { environment: 'production' });

  assert.throws(() => app.decisions.framework([]), /Permalink collision at \/about/,
    'a shipped site with two files at one URL is a broken site — the build stops');
});

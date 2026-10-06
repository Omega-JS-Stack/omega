/**
 * The LIVE decisions object (#200 Lane B): the scans whose product gates
 * per-page decisions — which framework default pages the consumer took over,
 * which collections the brand owns — are rescan captures, so the answer is a
 * live value the render asks for, never a value baked into the Eleventy
 * config. This suite pins the object itself: the captures re-scan, the gates
 * follow, and the collision diagnostic is loud in dev and fatal in a
 * production build.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const reads = require('@omega.js/devkit/reads');
const { setEnvironment } = require('@omega.js/config/environment');
const { createDecisions } = require('../src/decisions.js');

// A consumer tree ({ 'relative/path': contents }) inside an open capture scope
// — the shape configureOmega builds these in.
//
// The lane NAMES the environment (#817): `omega build` names production for the
// whole process and `omega dev` names development, so the collision gate reads
// the one input rather than a loose `options.environment` of its own.
function consumer(t, files, options) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-decisions-')));
  const savedEnvironment = process.env.OMEGA_ENVIRONMENT;
  setEnvironment((options && options.environment) || 'development');
  t.after(() => {
    reads.closeScope();
    if (savedEnvironment === undefined) delete process.env.OMEGA_ENVIRONMENT;
    else process.env.OMEGA_ENVIRONMENT = savedEnvironment;
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
    log: (message) => logged.push(message),
  });
  return { root, decisions, logged, write: (rel, contents) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  } };
}

module.exports = defineCases({
  type: 'group',
  description: 'decisions',
  tests: [
    {
      name: 'the consumer scan is a rescan capture, never a config-reset target',
      run: (ctx) => {
        const app = consumer(ctx, { 'pages/about.md': '---\npermalink: /about\n---\nabout' });

        ctx.expect(reads.recordedTargets(), 'a reset target here would rebuild the whole config on every page edit').toEqual([]);
        ctx.expect(reads.rescanTargets().map((target) => target.dir).sort(), 'both scans arm, including the collection dir the brand has not authored yet').toEqual([path.join(app.root, '_posts'), path.join(app.root, 'pages')]);
      },
    },

    {
      name: 're-running the pages capture updates the suppression answer',
      run: (ctx) => {
        const app = consumer(ctx, { 'pages/index.md': '---\npermalink: /\n---\nhome' });
        const pagesTarget = reads.rescanTargets().find((target) => target.dir.endsWith('pages'));

        ctx.expect(app.decisions.suppresses('/about')).toBe(false);
        app.write('pages/about.md', '---\npermalink: /about\n---\nabout');
        pagesTarget.rerun();

        ctx.expect(app.decisions.suppresses('/about'), 'the new page takes the URL over — the framework default steps aside on the next render').toBe(true);
      },
    },

    {
      name: 're-running the collection capture flips the own-content answer',
      run: (ctx) => {
        const app = consumer(ctx, { 'pages/index.md': '---\npermalink: /\n---\nhome' });
        const postsTarget = reads.rescanTargets().find((target) => target.dir.endsWith('_posts'));

        ctx.expect(app.decisions.hasOwn('_posts'), 'a content-less brand gets the sample corpus').toBe(false);
        app.write('_posts/2026-01-01-hello.md', '---\ntitle: Hello\n---\nhello');
        postsTarget.rerun();

        ctx.expect(app.decisions.hasOwn('_posts'), 'the first real post ends the samples').toBe(true);
      },
    },

    {
      name: 'refresh re-runs every capture at once',
      run: (ctx) => {
        const app = consumer(ctx, { 'pages/index.md': '---\npermalink: /\n---\nhome' });

        app.write('pages/about.md', '---\npermalink: /about\n---\nabout');
        app.write('_posts/2026-01-01-hello.md', '---\ntitle: Hello\n---\nhello');
        app.decisions.refresh();

        ctx.expect(app.decisions.suppresses('/about')).toBe(true);
        ctx.expect(app.decisions.hasOwn('_posts')).toBe(true);
      },
    },

    {
      name: 'a consumer-vs-consumer collision is reported loudly in dev',
      run: (ctx) => {
        const app = consumer(ctx, {
          'pages/about.md': '---\npermalink: /about\n---\nabout',
          'pages/company/about.md': '---\npermalink: /about.html\n---\nabout',
        });
        app.decisions.framework([]);

        ctx.expect(app.logged.length, 'one collision, one diagnostic').toBe(1);
        ctx.expect(app.logged[0]).toMatch(/Permalink collision at \/about/);
        ctx.expect(app.logged[0]).toMatch(/pages\/about\.md/);
        ctx.expect(app.logged[0]).toMatch(/pages\/company\/about\.md/);
      },
    },

    {
      name: 'a consumer page overriding a default page is never reported',
      run: (ctx) => {
        const app = consumer(ctx, { 'pages/about.md': '---\npermalink: /about\n---\nabout' });
        app.decisions.framework([{ label: 'defaults/pages/about.md', url: '/about' }]);

        ctx.expect(app.logged, 'suppression IS the override — warning about it would train the brand to ignore the log').toEqual([]);
        ctx.expect(app.decisions.suppressedUrls()).toEqual(['/about']);
      },
    },

    {
      name: 'a consumer page landing on a default page URL by a different spelling is reported',
      run: (ctx) => {
        const app = consumer(ctx, { 'pages/about.md': '---\npermalink: /about\n---\nabout' });
        app.decisions.framework([{ label: 'defaults/pages/about.md', url: '/about.html' }]);

        ctx.expect(app.logged.length).toBe(1);
        ctx.expect(app.logged[0]).toMatch(/Permalink collision at \/about/);
        ctx.expect(app.logged[0]).toMatch(/defaults\/pages\/about\.md/);
        ctx.expect(app.logged[0], 'the fix is the exact permalink — that is what suppresses the default page').toMatch(/exact/);
      },
    },

    {
      name: 'the diagnostic re-emits on every rescan while the collision persists',
      run: (ctx) => {
        const app = consumer(ctx, { 'pages/about.md': '---\npermalink: /about\n---\nabout' });
        app.decisions.framework([]);
        ctx.expect(app.logged).toEqual([]);

        app.write('pages/company/about.md', '---\npermalink: /about.html\n---\nabout');
        reads.rescanTargets().find((target) => target.dir.endsWith('pages')).rerun();
        ctx.expect(app.logged.length, 'the rescan finds it').toBe(1);

        app.decisions.refresh();
        ctx.expect(app.logged.length, 'still colliding, still loud — a fixed collision simply stops emitting').toBe(2);
      },
    },

    {
      name: 'a production build fails on a collision',
      run: (ctx) => {
        const app = consumer(ctx, {
          'pages/about.md': '---\npermalink: /about\n---\nabout',
          'pages/company/about.md': '---\npermalink: /about/\n---\nabout',
        }, { environment: 'production' });

        ctx.expect(() => app.decisions.framework([]), 'a shipped site with two files at one URL is a broken site — the build stops').toThrow(/Permalink collision at \/about/);
      },
    },
  ],
});

/**
 * The built-output link check ([#430](https://github.com/Omega-JS-Stack/omega/issues/430)):
 * `omega test` reads every internal href/src a built page emits and asks
 * whether the thing on the other end exists.
 *
 * The dist trees here are written to disk for real — the check's whole job is
 * to resolve URLs against files, so a mocked filesystem would prove nothing
 * about the contract it enforces.
 */
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const jetpack = require('fs-jetpack');

const {
  checkDistLinks,
  loadLinkExceptions,
  EXCEPTIONS_FILE,
} = require('../src/link-resolver.js');
const { linkCheckFailures } = require('../src/test/smoke.js');

/** A target root with a `dist/` written from `{ relativePath: contents }`. */
function tmpTarget(dist) {
  const root = jetpack.tmpDir({ prefix: 'omega-links-' }).path();
  const out = path.join(root, 'dist');
  for (const [file, contents] of Object.entries(dist)) {
    jetpack.write(path.join(out, file), contents);
  }
  return { root, out };
}

const page = (...links) => `<html><body>${links.map((l) => `<a href="${l}">x</a>`).join('')}</body></html>`;

/** The shape a healthy build has: every link lands on something it wrote. */
const CLEAN = {
  'index.html': page('/', '/about', '/blog', '/dashboard/account', 'https://example.com', 'mailto:a@b.c', '#top'),
  'about.html': `<html><head><link href="/assets/css/site.css"><script src="/assets/js/app.js"></script></head><body>${page('/')}</body></html>`,
  'blog/index.html': page('/', '/about/'),
  'dashboard/account.html': page('../about', './account', '/dashboard/account?tab=1'),
  'assets/css/site.css': 'body{}',
  'assets/js/app.js': '// app',
};

module.exports = defineCases({
  type: 'group',
  description: 'link-resolver',
  tests: [
    {
      name: '#430: a dead internal link in the built dist fails the check',
      run: (ctx) => {
        const { out } = tmpTarget({ ...CLEAN, 'index.html': page('/', '/about', '/spotify') });

        const result = checkDistLinks({ distDir: out });

        ctx.expect(result.offenders).toEqual(['/spotify (linked from index.html)']);
        ctx.expect(result.stale).toEqual([]);
      },
    },

    {
      name: '#430: the same dist without the dead link passes clean, with ZERO exceptions',
      run: (ctx) => {
        const { out } = tmpTarget(CLEAN);

        const result = checkDistLinks({ distDir: out });

        ctx.expect(result.offenders, 'a healthy build needs no exception list').toEqual([]);
        ctx.expect(result.stale).toEqual([]);
        ctx.expect(result.pageCount, 'every html page was read — an empty walk would pass vacuously').toBe(4);
      },
    },

    {
      name: '#430: the URL contract — foo.html, foo/index.html, assets as-is, relative values',
      run: (ctx) => {
        const { out } = tmpTarget({
          ...CLEAN,
          // `/blog` is served by blog/index.html; `/assets/...` is the file itself;
          // `../about` resolves from dashboard/. All four already pass in CLEAN, so
          // the proof is that each one FAILS the moment its target is gone.
          'gaps.html': page('/blog/missing', '/assets/js/missing.js', 'nope', '/dashboard'),
        });

        const result = checkDistLinks({ distDir: out });

        ctx.expect(result.offenders).toEqual([
          '/assets/js/missing.js (linked from gaps.html)',
          '/blog/missing (linked from gaps.html)',
          // A directory is not a page: dist/dashboard/ exists, dashboard.html does not.
          '/dashboard (linked from gaps.html)',
          '/nope (linked from gaps.html)',
        ]);
      },
    },

    {
      name: '#430: an exception excuses its own source page only',
      run: (ctx) => {
        const { out } = tmpTarget({
          ...CLEAN,
          'admin.html': page('/admin/notifications/new'),
          'brand-page.html': page('/admin/notifications/new'),
        });

        const declared = checkDistLinks({
          distDir: out,
          exceptions: { 'admin.html': ['/admin/notifications/new'] },
        });

        // Same dead URL, an undeclared page: a brand page never rides on a
        // framework-owned gap.
        ctx.expect(declared.offenders).toEqual(['/admin/notifications/new (linked from brand-page.html)']);
        ctx.expect(declared.stale).toEqual([]);

        const both = checkDistLinks({
          distDir: out,
          exceptions: { 'admin.html': ['/admin/notifications/new'], 'brand-page.html': ['/admin/notifications/new'] },
        });
        ctx.expect(both.offenders).toEqual([]);
      },
    },

    {
      name: '#430: a declared exception that has started resolving is reported, not ignored',
      run: (ctx) => {
        const { out } = tmpTarget(CLEAN);

        // An exception left standing over a fixed link masks the next regression
        // at that URL, so the list has to shrink when the break is fixed.
        const result = checkDistLinks({
          distDir: out,
          exceptions: { 'index.html': ['/about'], 'blog/index.html': ['/gone', '/about'] },
        });

        ctx.expect(result.offenders).toEqual([]);
        ctx.expect(result.stale).toEqual([
          'blog/index.html → /about',
          // Declared for blog/index.html, but that page does not emit it at all.
          'blog/index.html → /gone',
          'index.html → /about',
        ]);
      },
    },

    {
      name: '#430: the exception list is a conventional file — absent is empty, malformed is loud',
      run: (ctx) => {
        const { root } = tmpTarget(CLEAN);
        ctx.expect(loadLinkExceptions(root), 'no file = no exceptions, the state a brand should be in').toEqual({});

        jetpack.write(path.join(root, EXCEPTIONS_FILE), { 'admin.html': ['/admin/notifications/new'] });
        ctx.expect(loadLinkExceptions(root)).toEqual({ 'admin.html': ['/admin/notifications/new'] });

        // A shape the check cannot read must never degrade into "no exceptions" —
        // that would silently turn the declared list off.
        jetpack.write(path.join(root, EXCEPTIONS_FILE), { 'admin.html': '/one-link' });
        ctx.expect(() => loadLinkExceptions(root)).toThrow(/must be an object of/);
      },
    },

    {
      name: '#521: an href DISPLAYED as escaped code is not a link the page emits',
      run: (ctx) => {
        // The section gallery prints a variant's args as a copyable `<pre><code>`
        // block, so a demo variant carrying markup with a link had its escaped
        // `href=` read as a real anchor and reported unresolvable — the variant had
        // to be authored as a <button> to pass.
        const { out } = tmpTarget({
          ...CLEAN,
          'gallery.html': '<html><body>'
            + '<pre class="border rounded"><code>{ "content": "&lt;a href=&quot;/nowhere&quot;&gt;Apply theme&lt;/a&gt;" }</code></pre>'
            + '</body></html>',
          // The same URL in a REAL anchor is still the failure it always was.
          'real.html': page('/nowhere'),
        });

        ctx.expect(checkDistLinks({ distDir: out }).offenders).toEqual([
          '/nowhere (linked from real.html)',
        ]);
      },
    },

    {
      name: '#601: an href inside a SINGLE-quoted attribute value is not a link the page emits',
      run: (ctx) => {
        // studymonkey's shape: a brand hands structured content to client JS in a
        // data attribute, `escape` writes the inner quotes as &quot;, and the
        // minifier emits the attribute single-quoted with those quotes decoded back.
        // The raw text then holds ` href=\"`, which a quote-blind scan read as a
        // bare value of `\` — three dead links on 130+ pages that no page emits.
        const { out } = tmpTarget({
          ...CLEAN,
          'facts.html': '<html><body>'
            + '<form data-fun-facts=\'[\n  "Did you know we have a <a href=\\"/discord\\" target=\\"_blank\\">Discord</a>?"\n]\'></form>'
            + '</body></html>',
          // The same page's REAL links still resolve on their own merits.
          'linked.html': page('/about', '/nowhere'),
        });

        ctx.expect(checkDistLinks({ distDir: out }).offenders).toEqual([
          '/nowhere (linked from linked.html)',
        ]);
      },
    },

    {
      name: '#601: a single-quoted attribute never hides the links around it',
      run: (ctx) => {
        // The quote-aware parse skips the whole value, so an anchor AFTER a
        // single-quoted attribute is read exactly as before.
        const { out } = tmpTarget({
          ...CLEAN,
          'mixed.html': '<html><body>'
            + '<form data-facts=\'["see <a href=\\"/discord\\">discord</a>"]\'></form>'
            + '<a href=\'/single-quoted-gone\'>x</a>'
            + '<a href="/double-quoted-gone">y</a>'
            + '</body></html>',
        });

        ctx.expect(checkDistLinks({ distDir: out }).offenders).toEqual([
          '/double-quoted-gone (linked from mixed.html)',
          '/single-quoted-gone (linked from mixed.html)',
        ]);
      },
    },

    {
      name: '#490: the exception list is json5 — the WHY lives beside the entry',
      run: (ctx) => {
        const { root } = tmpTarget(CLEAN);

        // An exception is a last resort, so the reason it exists has to travel with
        // it: strict JSON left every rationale in some worksheet the file never sees.
        jetpack.write(path.join(root, EXCEPTIONS_FILE), [
          '{',
          '  // #488: the tag cloud links a slug the taxonomy page is not emitted at.',
          '  "blog/tags.html": [\'/blog/tags/a-and-r\'],',
          '}',
        ].join('\n'));

        ctx.expect(loadLinkExceptions(root)).toEqual({ 'blog/tags.html': ['/blog/tags/a-and-r'] });
      },
    },

    {
      name: '#490: a leftover strict-JSON exception list is named, never silently ignored',
      run: (ctx) => {
        const { root } = tmpTarget(CLEAN);
        jetpack.write(path.join(root, path.join('config', 'link-exceptions.json')), { 'admin.html': ['/admin/legacy'] });

        ctx.expect(() => loadLinkExceptions(root)).toThrow(/link-exceptions\.json5/);
      },
    },

    {
      name: '#430: `omega test` surfaces the check as smoke-check failures',
      run: (ctx) => {
        const { root, out } = tmpTarget({ ...CLEAN, 'index.html': page('/', '/spotify') });

        ctx.expect(linkCheckFailures({ distDir: out, targetRoot: root })).toEqual([
          'dead internal link: /spotify (linked from index.html); add the page or fix the link',
        ]);

        // Declared, and the declaration is itself checked.
        jetpack.write(path.join(root, EXCEPTIONS_FILE), { 'index.html': ['/spotify', '/about'] });
        ctx.expect(linkCheckFailures({ distDir: out, targetRoot: root })).toEqual([
          `stale link exception in ${EXCEPTIONS_FILE}: index.html → /about resolves now; drop it`,
        ]);

        jetpack.write(path.join(root, EXCEPTIONS_FILE), { 'index.html': ['/spotify'] });
        ctx.expect(linkCheckFailures({ distDir: out, targetRoot: root })).toEqual([]);
      },
    },

    {
      name: '#430: the check is unaffected by where the OS puts a temp dir',
      run: (ctx) => {
        // A guard on the walk's path handling: dist-relative ids, never absolute ones
        // (macOS hands out /var → /private/var symlinks, Windows hands out `\`).
        const { out } = tmpTarget({ ...CLEAN, 'deep/nested/page.html': page('/spotify') });

        ctx.expect(checkDistLinks({ distDir: out }).offenders).toEqual(['/spotify (linked from deep/nested/page.html)']);
        ctx.expect(!out.startsWith(path.join(os.tmpdir(), 'dist')), 'the fixture really is a temp target root').toBeTruthy();
      },
    },

    {
      name: '#755: a MOUNTED build resolves its own base path, not a site of dead links',
      run: (ctx) => {
        // A project site (brand.url carrying a path) ships every root-relative URL
        // under the mount point, while dist paths stay site-relative. Read raw, every
        // internal link on every page resolves against the wrong file and reads dead.
        const mount = (html) => html.replace('<html>', '<html data-omega-path-prefix="/repo">');
        const { out } = tmpTarget({
          'index.html': mount(page('/repo/', '/repo/about', '/repo/blog', 'https://example.com')),
          'about.html': mount(`<html><head><link href="/repo/assets/css/site.css"></head><body>${page('/repo/')}</body></html>`),
          'blog/index.html': mount(page('/repo/about/', './index')),
          'assets/css/site.css': 'body{}',
          // The mount changes nothing about a link that really is dead — and it is
          // named by the SITE url, the one a brand's exception list is written in.
          'gaps.html': mount(page('/repo/spotify')),
        });

        const result = checkDistLinks({ distDir: out });

        ctx.expect(result.offenders).toEqual(['/spotify (linked from gaps.html)']);
        ctx.expect(result.stale).toEqual([]);
        ctx.expect(result.pageCount, 'every html page was read — an empty walk would pass vacuously').toBe(4);
      },
    },
  ],
});

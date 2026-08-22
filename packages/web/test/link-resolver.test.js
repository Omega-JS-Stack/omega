/**
 * The built-output link check ([#430](https://github.com/Omega-JS-Stack/omega/issues/430)):
 * `omega test` reads every internal href/src a built page emits and asks
 * whether the thing on the other end exists.
 *
 * The dist trees here are written to disk for real — the check's whole job is
 * to resolve URLs against files, so a mocked filesystem would prove nothing
 * about the contract it enforces.
 */
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const jetpack = require('fs-jetpack');

const {
  checkDistLinks,
  loadLinkExceptions,
  EXCEPTIONS_FILE,
} = require('../src/link-resolver.js');
const { linkCheckFailures } = require('../src/commands/test.js');

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

test('#430: a dead internal link in the built dist fails the check', () => {
  const { out } = tmpTarget({ ...CLEAN, 'index.html': page('/', '/about', '/spotify') });

  const result = checkDistLinks({ distDir: out });

  assert.deepStrictEqual(result.offenders, ['/spotify (linked from index.html)']);
  assert.deepStrictEqual(result.stale, []);
});

test('#430: the same dist without the dead link passes clean, with ZERO exceptions', () => {
  const { out } = tmpTarget(CLEAN);

  const result = checkDistLinks({ distDir: out });

  assert.deepStrictEqual(result.offenders, [], 'a healthy build needs no exception list');
  assert.deepStrictEqual(result.stale, []);
  assert.strictEqual(result.pageCount, 4, 'every html page was read — an empty walk would pass vacuously');
});

test('#430: the URL contract — foo.html, foo/index.html, assets as-is, relative values', () => {
  const { out } = tmpTarget({
    ...CLEAN,
    // `/blog` is served by blog/index.html; `/assets/...` is the file itself;
    // `../about` resolves from dashboard/. All four already pass in CLEAN, so
    // the proof is that each one FAILS the moment its target is gone.
    'gaps.html': page('/blog/missing', '/assets/js/missing.js', 'nope', '/dashboard'),
  });

  const result = checkDistLinks({ distDir: out });

  assert.deepStrictEqual(result.offenders, [
    '/assets/js/missing.js (linked from gaps.html)',
    '/blog/missing (linked from gaps.html)',
    // A directory is not a page: dist/dashboard/ exists, dashboard.html does not.
    '/dashboard (linked from gaps.html)',
    '/nope (linked from gaps.html)',
  ]);
});

test('#430: an exception excuses its own source page only', () => {
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
  assert.deepStrictEqual(declared.offenders, ['/admin/notifications/new (linked from brand-page.html)']);
  assert.deepStrictEqual(declared.stale, []);

  const both = checkDistLinks({
    distDir: out,
    exceptions: { 'admin.html': ['/admin/notifications/new'], 'brand-page.html': ['/admin/notifications/new'] },
  });
  assert.deepStrictEqual(both.offenders, []);
});

test('#430: a declared exception that has started resolving is reported, not ignored', () => {
  const { out } = tmpTarget(CLEAN);

  // An exception left standing over a fixed link masks the next regression
  // at that URL, so the list has to shrink when the break is fixed.
  const result = checkDistLinks({
    distDir: out,
    exceptions: { 'index.html': ['/about'], 'blog/index.html': ['/gone', '/about'] },
  });

  assert.deepStrictEqual(result.offenders, []);
  assert.deepStrictEqual(result.stale, [
    'blog/index.html → /about',
    // Declared for blog/index.html, but that page does not emit it at all.
    'blog/index.html → /gone',
    'index.html → /about',
  ]);
});

test('#430: the exception list is a conventional file — absent is empty, malformed is loud', () => {
  const { root } = tmpTarget(CLEAN);
  assert.deepStrictEqual(loadLinkExceptions(root), {}, 'no file = no exceptions, the state a brand should be in');

  jetpack.write(path.join(root, EXCEPTIONS_FILE), { 'admin.html': ['/admin/notifications/new'] });
  assert.deepStrictEqual(loadLinkExceptions(root), { 'admin.html': ['/admin/notifications/new'] });

  // A shape the check cannot read must never degrade into "no exceptions" —
  // that would silently turn the declared list off.
  jetpack.write(path.join(root, EXCEPTIONS_FILE), { 'admin.html': '/one-link' });
  assert.throws(() => loadLinkExceptions(root), /must be an object of/);
});

test('#430: `omega test` surfaces the check as smoke-check failures', () => {
  const { root, out } = tmpTarget({ ...CLEAN, 'index.html': page('/', '/spotify') });

  assert.deepStrictEqual(linkCheckFailures({ distDir: out, targetRoot: root }), [
    'dead internal link: /spotify (linked from index.html) — add the page or fix the link',
  ]);

  // Declared, and the declaration is itself checked.
  jetpack.write(path.join(root, EXCEPTIONS_FILE), { 'index.html': ['/spotify', '/about'] });
  assert.deepStrictEqual(linkCheckFailures({ distDir: out, targetRoot: root }), [
    `stale link exception in ${EXCEPTIONS_FILE}: index.html → /about resolves now — drop it`,
  ]);

  jetpack.write(path.join(root, EXCEPTIONS_FILE), { 'index.html': ['/spotify'] });
  assert.deepStrictEqual(linkCheckFailures({ distDir: out, targetRoot: root }), []);
});

test('#430: the check is unaffected by where the OS puts a temp dir', () => {
  // A guard on the walk's path handling: dist-relative ids, never absolute ones
  // (macOS hands out /var → /private/var symlinks, Windows hands out `\`).
  const { out } = tmpTarget({ ...CLEAN, 'deep/nested/page.html': page('/spotify') });

  assert.deepStrictEqual(
    checkDistLinks({ distDir: out }).offenders,
    ['/spotify (linked from deep/nested/page.html)'],
  );
  assert.ok(!out.startsWith(path.join(os.tmpdir(), 'dist')), 'the fixture really is a temp target root');
});

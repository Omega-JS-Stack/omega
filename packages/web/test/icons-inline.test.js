/**
 * #619 — the ONE icon system: native Font Awesome markup everywhere, inlined
 * at build, upgraded at runtime.
 *
 * The build half. `inlineIcons` is a post-render pass over the finished HTML,
 * so it is unit-testable the way cachebreak-html.js is, plus one real
 * mini-site build proving the transform is wired into the Eleventy lane.
 *
 * The load-bearing property: the markup this pass emits is BYTE-IDENTICAL to
 * what @omega.js/client's icon-renderer would have produced in the browser —
 * same `data-omega-fa` stamp, same injected SVG root attributes — so build
 * and runtime can never render the same icon two different ways.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { inlineIcons } = require('../src/inline-icons.js');
const { createIconLoader, resolveFontAwesomeRoots } = require('@omega.js/devkit/icons');
const { buildWith, miniData, PKG } = require('./lib/build.js');

const fa = resolveFontAwesomeRoots();
const load = createIconLoader({
  svgsDirs: [path.join(PKG, 'core', 'icons'), ...fa.svgsDirs],
  aliasFile: fa.aliasFile,
});

test('#619: native fa-* markup gets its SVG inlined and the renderer stamp', () => {
  const out = inlineIcons('<p>hi <i class="fa-solid fa-rocket"></i></p>', load);

  assert.match(out, /<i class="fa-solid fa-rocket" data-omega-fa="solid\/rocket">/, 'the runtime stamp, emitted at build');
  assert.match(out, /<svg[^>]*viewBox/, 'the real SVG landed inside the <i>');
  assert.match(out, /width="1em"/, 'icon-core root attributes injected — the same pass the browser runs');
  assert.match(out, /fill="currentColor"/);
  assert.ok(out.startsWith('<p>hi <i') && out.endsWith('</i></p>'), 'surrounding markup untouched');
});

test('#619: modifier classes ride along and never read as the icon name', () => {
  const out = inlineIcons('<i class="fa-solid fa-spinner fa-spin fa-2xl me-2"></i>', load);

  assert.match(out, /data-omega-fa="solid\/spinner"/, 'fa-spin/fa-2xl/me-2 are modifiers, not names');
  assert.match(out, /class="fa-solid fa-spinner fa-spin fa-2xl me-2"/, 'the author class list survives verbatim');
});

test('#619: an inlined icon never terminates a surrounding HTML comment', () => {
  // The flash-sale banner bug: body.html keeps the sale alert COMMENTED OUT,
  // but the fa-stopwatch inside it was inlined with Font Awesome's own
  // `<!--! … -->` license comment in the SVG — whose `-->` ended the outer
  // comment early and rendered the dead banner (plus a stray `-->`) on every
  // page. The injected SVG must carry no comment at all.
  const page = '<!-- <div class="sale"><i class="fa-solid fa-rocket"></i></div> --><p>after</p>';
  const out = inlineIcons(page, load);

  assert.ok(!out.includes('<!--!'), 'the FA license comment is stripped from the injected SVG');
  assert.strictEqual(out.indexOf('-->'), out.lastIndexOf('-->'), 'only the author\'s own comment terminator remains');
  assert.ok(out.indexOf('-->') > out.indexOf('</div>'), 'the commented-out block stays commented to its real close');
});

test('#619: a brands name resolves through the brands fallback', () => {
  const out = inlineIcons('<i class="fa-brands fa-github"></i>', load);

  assert.match(out, /data-omega-fa="brands\/github"/);
  assert.match(out, /<svg/, 'the github mark inlined');
});

test('#619: an alias resolves to its canonical glyph', () => {
  // 'search' is an alias of 'magnifying-glass' in the set's own metadata.
  const out = inlineIcons('<i class="fa-solid fa-search"></i>', load);

  assert.match(out, /data-omega-fa="solid\/search"/, 'the stamp names what the author wrote');
  assert.match(out, /<svg/, '…and the canonical glyph is what landed');
});

test('#619: flags are the second namespace on the same pipeline', () => {
  const out = inlineIcons('<i class="omega-flag omega-flag-us"></i>', load);

  assert.match(out, /data-omega-fa="flags\/us"/, 'one stamp, both namespaces');
  assert.match(out, /<svg/, 'the flag SVG inlined');
  assert.ok(!/<svg[^>]*\swidth="512"/.test(out), 'the flag set\'s hardcoded 512 box is stripped for 1em sizing');
  assert.match(out, /width="1em"/);
});

test('#619: an unresolvable icon is marked, reported, and left for the runtime', () => {
  const missed = [];
  const out = inlineIcons('<i class="fa-solid fa-not-a-real-glyph"></i>', load, (key) => missed.push(key));

  assert.deepStrictEqual(missed, ['solid/not-a-real-glyph'], 'the build reports the miss by name');
  assert.match(out, /data-omega-icon-missing="solid\/not-a-real-glyph"/, 'the dev audit\'s marker');
  assert.match(out, /data-omega-fa="solid\/not-a-real-glyph"/, 'stamped as handled — the runtime never re-fetches a set miss');
  assert.ok(!out.includes('<svg'), 'a missing icon is empty, never a wrong-glyph fallback');
});

test('#619: non-icon <i> elements are none of this pass\'s business', () => {
  const html = [
    '<i>emphasis</i>',
    '<i class="fa-spin"></i>',
    '<i class="fa-solid fa-rocket">already filled</i>',
    '<span class="fa-solid fa-rocket"></span>',
  ].join('\n');

  assert.strictEqual(inlineIcons(html, load), html, 'italics, name-less modifier lists, filled wrappers and non-<i> tags pass through');
});

test('#619: the mini-site build inlines its chrome icons', async () => {
  const pages = await buildWith(miniData, {}, 'icons-inline-test');
  const html = pages.get('/');

  assert.match(html, /data-omega-fa="[a-z-]+\/[a-z0-9-]+"/, 'the transform is wired into the Eleventy lane');
  assert.match(html, /data-omega-fa="[^"]*"><svg/, 'every stamped icon carries its glyph inline — no runtime fetch for static chrome');
  assert.ok(!html.includes('data-omega-icon-missing'), 'stock chrome resolves every icon it names');
});

// ---- The retired mechanisms (#607 rides this issue): one system means the
//      old two are GONE from the tree, not merely unused.

const SWEPT_DIRS = ['core', 'defaults', 'themes', 'src', 'runtime', 'scaffold'];

// The migration lane is the ONE place the retired names may still be spelled:
// converting a legacy tree means recognising `{% uj_icon %}` / `{% omega_icon %}`
// and rewriting them (src/migrate/rules.js, the icon-tag-markup rule).
const RETIRED_NAME_EXEMPT = path.join('src', 'migrate');

/** Every source file under a package dir, minus build output. */
function sourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    if (full.includes(`${path.sep}node_modules${path.sep}`)) continue;
    files.push(full);
  }
  return files;
}

test('#619/#607: omega_icon, prerender_icons and the prerendered-icons lib are gone', () => {
  const offenders = [];

  for (const dir of SWEPT_DIRS) {
    for (const file of sourceFiles(path.join(PKG, dir))) {
      if (path.relative(PKG, file).startsWith(RETIRED_NAME_EXEMPT)) continue;
      const body = fs.readFileSync(file, 'utf8');
      for (const term of ['omega_icon', 'prerender_icons', 'prerendered-icons', 'getPrerenderedIcon']) {
        if (body.includes(term)) offenders.push(`${path.relative(PKG, file)}: ${term}`);
      }
    }
  }

  assert.deepStrictEqual([...new Set(offenders)], []);
});

test('#619: the omega_icon tag is gone from template-kit too', () => {
  const kit = path.join(PKG, '..', 'template-kit', 'src');
  const offenders = sourceFiles(kit)
    .filter((file) => fs.readFileSync(file, 'utf8').includes('omega_icon'))
    .map((file) => path.relative(kit, file));

  assert.deepStrictEqual(offenders, []);
});

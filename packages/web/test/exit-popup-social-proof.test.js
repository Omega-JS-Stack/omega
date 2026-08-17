/**
 * The exit popup's social proof (#44 item 21) — the "Join 10k+ happy
 * subscribers!" line renders its face stack again. Default: the four real
 * portraits the framework now SHIPS (legacy UJM hotlinked them from
 * i.pravatar.cc; they live in core/images/exit-popup and bridge to
 * /assets/images/core). A brand replaces them through
 * client.exitPopup.config.avatars, and an explicit empty list falls back to
 * neutral glyph slots.
 *
 * The same popup's heading order (#316): it mounts on every page, so a skip
 * inside it fails the heading-order rule on pages whose own content is clean.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { PATHS } = require('../src/paths.js');
const { resolveStaticDirs } = require('../src/static-assets.js');
const { buildWith, miniData } = require('./lib/build.js');

/** The social-proof row markup out of a rendered page. */
function socialProof(html) {
  const start = html.indexOf('<!-- Social proof');
  assert.ok(start > -1, 'the exit popup renders a social-proof block');
  const end = html.indexOf('Join 10k+', start);
  assert.ok(end > -1, 'the subscriber line is part of that block');
  return html.slice(start, html.indexOf('</div>', end));
}

/** The whole popup's markup out of a rendered page. */
function popup(html) {
  const start = html.indexOf('<div id="modal-exit-popup"');
  assert.ok(start > -1, 'the page mounts the exit popup');
  const end = html.indexOf('var Configuration', start);
  assert.ok(end > -1, 'the popup closes before the configuration blob');
  return html.slice(start, end);
}

test('the popup\'s headings step one level at a time (#316)', async () => {
  const pages = await buildWith(miniData, {}, 'exit-popup-headings');
  const levels = [...popup(pages.get('/')).matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));

  // The popup titles itself h3 (it is a dialog inside a page that owns h1/h2),
  // and the offer box is its one subsection.
  assert.deepStrictEqual(levels, [3, 4], 'the offer title sits one level under the popup title, not two');
});

test('unconfigured: the four shipped portraits stand beside the subscriber line', async () => {
  const pages = await buildWith(miniData, {}, 'exit-popup-default');
  const block = socialProof(pages.get('/'));

  assert.equal((block.match(/modal-exit-avatar/g) || []).length, 4, 'four faces, like the legacy row');
  assert.equal((block.match(/me-n2/g) || []).length, 3, 'every slot but the last overlaps the next');
  for (const n of [1, 2, 3, 4]) {
    assert.ok(
      block.includes(`data-lazy="@src /assets/images/core/exit-popup/subscriber-${n}.jpg"`),
      `face ${n} lazy-loads the shipped photo`,
    );
  }
  assert.equal((block.match(/alt=""/g) || []).length, 4, 'decorative: the line carries the meaning');
  assert.ok(!block.includes('data-icon="user"'), 'real photos, not glyph slots');

  // The framework never hotlinks — every default face is a local path
  assert.ok(!/data-lazy="@src https?:/.test(block), 'no external image URL, ever');
});

test('the shipped portraits exist on disk and reach the built site', () => {
  for (const n of [1, 2, 3, 4]) {
    const file = path.join(PATHS.core, 'images', 'exit-popup', `subscriber-${n}.jpg`);
    assert.ok(fs.existsSync(file), `${file} ships with the package`);
  }

  // The static channel carries core/images to the URL the include references
  const core = resolveStaticDirs({ brandRoot: null, assetsDir: path.join(PATHS.core, 'nope') })
    .find((entry) => entry.dest === 'assets/images/core');
  assert.ok(core, 'core images are a static-copy entry');
  assert.equal(core.src, path.join(PATHS.core, 'images'));
});

test('an explicit empty list falls back to neutral glyph slots', async () => {
  const pages = await buildWith(
    {
      ...miniData,
      client: { ...miniData.client, exitPopup: { config: { avatars: [] } } },
    },
    {},
    'exit-popup-neutral',
  );
  const block = socialProof(pages.get('/'));

  assert.equal((block.match(/modal-exit-avatar/g) || []).length, 4, 'the row keeps its four slots');
  assert.ok(!block.includes('<img'), 'opting out of faces means no image');
  assert.ok(block.includes('data-icon="user"'), 'a neutral glyph fills the empty slot');
});

test('configured: the brand faces render lazily, decorative', async () => {
  const pages = await buildWith(
    {
      ...miniData,
      client: {
        ...miniData.client,
        exitPopup: { config: { avatars: ['/assets/images/a.jpg', '/assets/images/b.jpg'] } },
      },
    },
    {},
    'exit-popup-configured',
  );
  const block = socialProof(pages.get('/'));

  assert.equal((block.match(/modal-exit-avatar/g) || []).length, 2, 'exactly the configured faces, no padding');
  assert.ok(block.includes('data-lazy="@src /assets/images/a.jpg"'), 'first face lazy-loads its configured source');
  assert.ok(block.includes('data-lazy="@src /assets/images/b.jpg"'), 'second face too');
  assert.equal((block.match(/alt=""/g) || []).length, 2, 'decorative: the line carries the meaning');
  assert.ok(!block.includes('data-icon="user"'), 'configured faces replace the neutral glyphs');
});

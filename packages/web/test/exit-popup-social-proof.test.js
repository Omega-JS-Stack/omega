/**
 * The exit popup's social proof (#44 item 21) — the "Join 10k+ happy
 * subscribers!" line renders its face stack again. Default: four neutral
 * slots, because the framework ships no photos and never hotlinks one. A
 * brand supplies real faces through client.exitPopup.config.avatars, and
 * those render as lazy images with decorative alt text.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith, miniData } = require('./lib/build.js');

/** The social-proof row markup out of a rendered page. */
function socialProof(html) {
  const start = html.indexOf('<!-- Social proof');
  assert.ok(start > -1, 'the exit popup renders a social-proof block');
  const end = html.indexOf('Join 10k+', start);
  assert.ok(end > -1, 'the subscriber line is part of that block');
  return html.slice(start, html.indexOf('</div>', end));
}

test('unconfigured: four neutral slots stand beside the subscriber line', async () => {
  const pages = await buildWith(miniData, {}, 'exit-popup-neutral');
  const block = socialProof(pages.get('/'));

  assert.equal((block.match(/modal-exit-avatar/g) || []).length, 4, 'four faces, like the legacy row');
  assert.equal((block.match(/me-n2/g) || []).length, 3, 'every slot but the last overlaps the next');
  assert.ok(!block.includes('<img'), 'nothing invented: no image without a configured source');
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

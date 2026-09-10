/**
 * The about page's picture surfaces (#44 item 14): `about/hero` flips to the
 * photo lead when a brand supplies image:, `about/letter` grows an aside
 * photo the same way — and BOTH render exactly the old markup when the arg is
 * absent (an unset image is nothing, never an empty frame). Pinned at the
 * mini-site seam through the showcase gallery's per-variant frame pages
 * (#463), where every demo variant renders live through the real tag.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'about-photos-test');

test('about/hero: image: leads with the photo; without it the statement split is untouched', async () => {
  const pages = await buildWith(miniData);

  assert.ok(pages.get('/test/sections/about/hero'), 'the entry is in the library');

  // Three demo variants, one embedded-frame page each (#463): statement only,
  // facts rail, photo lead.
  const FRAMES = '/test/sections/about/hero/frames/';
  const photo = pages.get(`${FRAMES}photo-lead`);
  const imageless = (pages.get(`${FRAMES}statement-only`) || '') + (pages.get(`${FRAMES}with-facts-rail`) || '');
  assert.ok(photo, 'the photo-lead variant frame built');

  assert.equal((photo.match(/class="omega-photo-lead"/g) || []).length, 1, 'only the image variant paints a photo lead');
  assert.ok(!imageless.includes('omega-photo-lead'), 'the imageless variants paint none');
  assert.equal((imageless.match(/class="omega-hero-split"/g) || []).length, 2, 'the imageless variants keep the statement split');
  assert.ok(photo.includes('alt="Placeholder artwork in warm amber tones"'), 'the photo carries its describing alt (role="img" mandates a non-empty label)');
  assert.ok(/omega-photo-lead__img[^>]*data-lazy="@src /.test(photo), 'the lead rides the standard lazy lane');
  assert.ok(photo.includes('omega-photo-lead__facts'), 'the facts rail follows the picture');
});

test('about/letter: image: hangs a photo in the aside; without it the aside is unchanged', async () => {
  const pages = await buildWith(miniData);

  assert.ok(pages.get('/test/sections/about/letter'), 'the entry is in the library');

  // Two demo variants: the default letter and the one with the aside photo
  const FRAMES = '/test/sections/about/letter/frames/';
  const photo = pages.get(`${FRAMES}with-the-aside-photo`);
  const plain = pages.get(`${FRAMES}default-letter`);
  assert.ok(photo && plain, 'both variant frames built');

  assert.equal((photo.match(/class="omega-aside-photo"/g) || []).length, 1, 'only the image variant frames a photo');
  assert.ok(!plain.includes('omega-aside-photo'), 'the default letter frames none');
  assert.ok(photo.includes('alt="Placeholder artwork in soft green tones"'), 'the aside photo describes itself');
  assert.equal(((photo + plain).match(/class="omega-duo__aside"/g) || []).length, 2, 'both variants keep the aside itself');
});

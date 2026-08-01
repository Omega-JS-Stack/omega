/**
 * The about page's picture surfaces (#44 item 14): `about/hero` flips to the
 * photo lead when a brand supplies image:, `about/letter` grows an aside
 * photo the same way — and BOTH render exactly the old markup when the arg is
 * absent (an unset image is nothing, never an empty frame). Pinned at the
 * mini-site seam through the showcase pages, where every demo variant renders
 * live through the real tag.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'about-photos-test');

test('about/hero: image: leads with the photo; without it the statement split is untouched', async () => {
  const pages = await buildWith(miniData);
  const hero = pages.get('/test/sections/section/about/hero');

  assert.ok(hero, 'the entry is in the library');

  // Three demo variants: statement only, facts rail, photo lead
  assert.equal((hero.match(/class="classy-photo-lead"/g) || []).length, 1, 'only the image variant paints a photo lead');
  assert.equal((hero.match(/class="classy-hero-split"/g) || []).length, 2, 'the imageless variants keep the statement split');
  assert.ok(hero.includes('alt="The team working around one table in the studio"'), 'the photo carries its describing alt — content, not decoration');
  assert.ok(/classy-photo-lead__img[^>]*data-lazy="@src /.test(hero), 'the lead rides the standard lazy lane');
  assert.ok(hero.includes('classy-photo-lead__facts'), 'the facts rail follows the picture');
});

test('about/letter: image: hangs a photo in the aside; without it the aside is unchanged', async () => {
  const pages = await buildWith(miniData);
  const letter = pages.get('/test/sections/section/about/letter');

  assert.ok(letter, 'the entry is in the library');

  // Two demo variants: the default letter and the one with the aside photo
  assert.equal((letter.match(/class="classy-aside-photo"/g) || []).length, 1, 'only the image variant frames a photo');
  assert.ok(letter.includes('alt="A notebook and coffee on a wooden desk"'), 'the aside photo describes itself');
  assert.equal((letter.match(/class="classy-duo__aside"/g) || []).length, 2, 'both variants keep the aside itself');
});

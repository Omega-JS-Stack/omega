/**
 * The about page's picture surfaces (#44 item 14): `about/hero` flips to the
 * photo lead when a brand supplies image:, `about/letter` grows an aside
 * photo the same way — and BOTH render exactly the old markup when the arg is
 * absent (an unset image is nothing, never an empty frame). Pinned at the
 * mini-site seam through the showcase gallery's per-variant frame pages
 * (#463), where every demo variant renders live through the real tag.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'about-photos-test');

module.exports = defineCases({
  type: 'group',
  description: 'about-photos',
  tests: [
    {
      name: 'about/hero: image: leads with the photo; without it the statement split is untouched',
      run: async (ctx) => {
        const pages = await buildWith(miniData);

        ctx.expect(pages.get('/test/sections/about/hero'), 'the entry is in the library').toBeTruthy();

        // Three demo variants, one embedded-frame page each (#463): statement only,
        // facts rail, photo lead.
        const FRAMES = '/test/sections/about/hero/frames/';
        const photo = pages.get(`${FRAMES}photo-lead`);
        const imageless = (pages.get(`${FRAMES}statement-only`) || '') + (pages.get(`${FRAMES}with-facts-rail`) || '');
        ctx.expect(photo, 'the photo-lead variant frame built').toBeTruthy();

        ctx.expect((photo.match(/class="omega-photo-lead"/g) || []).length, 'only the image variant paints a photo lead').toBe(1);
        ctx.expect(!imageless.includes('omega-photo-lead'), 'the imageless variants paint none').toBeTruthy();
        ctx.expect((imageless.match(/class="omega-hero-split"/g) || []).length, 'the imageless variants keep the statement split').toBe(2);
        ctx.expect(photo.includes('alt="Placeholder artwork in warm amber tones"'), 'the photo carries its describing alt (role="img" mandates a non-empty label)').toBeTruthy();
        ctx.expect(/omega-photo-lead__img[^>]*data-lazy="@src /.test(photo), 'the lead rides the standard lazy lane').toBeTruthy();
        ctx.expect(photo.includes('omega-photo-lead__facts'), 'the facts rail follows the picture').toBeTruthy();
      },
    },

    {
      name: 'about/letter: image: hangs a photo in the aside; without it the aside is unchanged',
      run: async (ctx) => {
        const pages = await buildWith(miniData);

        ctx.expect(pages.get('/test/sections/about/letter'), 'the entry is in the library').toBeTruthy();

        // Two demo variants: the default letter and the one with the aside photo
        const FRAMES = '/test/sections/about/letter/frames/';
        const photo = pages.get(`${FRAMES}with-the-aside-photo`);
        const plain = pages.get(`${FRAMES}default-letter`);
        ctx.expect(photo && plain, 'both variant frames built').toBeTruthy();

        ctx.expect((photo.match(/class="omega-aside-photo"/g) || []).length, 'only the image variant frames a photo').toBe(1);
        ctx.expect(!plain.includes('omega-aside-photo'), 'the default letter frames none').toBeTruthy();
        ctx.expect(photo.includes('alt="Placeholder artwork in soft green tones"'), 'the aside photo describes itself').toBeTruthy();
        ctx.expect(((photo + plain).match(/class="omega-duo__aside"/g) || []).length, 'both variants keep the aside itself').toBe(2);
      },
    },
  ],
});

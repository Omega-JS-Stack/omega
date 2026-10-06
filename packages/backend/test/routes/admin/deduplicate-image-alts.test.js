/**
 * Test: routes/admin/post/deduplicate-image-alts
 * Unit tests for the alt-text dedup helper used by the admin/post route.
 *
 * Run: npx omega test routes/admin/deduplicate-image-alts
 *
 * Contract:
 *   - Header images are never modified.
 *   - Two non-header images with the same alt AND different URLs:
 *     the second's alt is suffixed with " (2)" (and " (3)" for the third, etc.)
 *     and the body is rewritten to match.
 *   - Two non-header images with the same alt AND the same URL:
 *     the second reuses the first's (possibly already-suffixed) alt — no change.
 *   - Images with distinct alts are untouched.
 */
const deduplicateImageAlts = require('../../../dist/omega/routes/admin/post/deduplicate-image-alts');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'routes/admin/post/deduplicate-image-alts',
  type: 'group',

  tests: [
    // ─── Happy path: no collisions ───

    {
      name: 'distinct-alts-are-untouched',
      async run({ expect }) {
        const images = [
          { src: 'https://a.com/1.jpg', alt: 'Cat', header: false },
          { src: 'https://a.com/2.jpg', alt: 'Dog', header: false },
        ];
        const body = '![Cat](https://a.com/1.jpg)\n\n![Dog](https://a.com/2.jpg)';
        const result = deduplicateImageAlts(images, body);

        expect(result.images[0].alt, 'First image alt unchanged').toBe('Cat');
        expect(result.images[1].alt, 'Second image alt unchanged').toBe('Dog');
        expect(result.body, 'Body is unchanged when no collisions').toBe(body);
      },
    },

    // ─── The bug: same alt, different URLs ───

    {
      name: 'same-alt-different-urls-suffixes-second',
      async run({ expect }) {
        const sharedAlt = '62f9b399-92c2-40c2-8ec4-e05b54077aaa';
        const images = [
          { src: 'https://a.com/1.jpg', alt: sharedAlt, header: false },
          { src: 'https://a.com/2.jpg', alt: sharedAlt, header: false },
        ];
        const body = `![${sharedAlt}](https://a.com/1.jpg)\n\nsome text\n\n![${sharedAlt}](https://a.com/2.jpg)`;
        const result = deduplicateImageAlts(images, body);

        expect(result.images[0].alt, 'First image keeps original alt').toBe(sharedAlt);
        expect(result.images[1].alt, 'Second image alt is suffixed with " (2)"').toBe(`${sharedAlt} (2)`);
        expect(result.body.includes(`![${sharedAlt}](https://a.com/1.jpg)`), 'Body still contains the first image with original alt').toBeTruthy();
        expect(result.body.includes(`![${sharedAlt} (2)](https://a.com/2.jpg)`), 'Body contains the second image with suffixed alt').toBeTruthy();
      },
    },

    {
      name: 'three-images-same-alt-different-urls-counts-up',
      async run({ expect }) {
        const sharedAlt = 'Logo';
        const images = [
          { src: 'https://a.com/1.jpg', alt: sharedAlt, header: false },
          { src: 'https://a.com/2.jpg', alt: sharedAlt, header: false },
          { src: 'https://a.com/3.jpg', alt: sharedAlt, header: false },
        ];
        const body = `![${sharedAlt}](https://a.com/1.jpg)\n![${sharedAlt}](https://a.com/2.jpg)\n![${sharedAlt}](https://a.com/3.jpg)`;
        const result = deduplicateImageAlts(images, body);

        expect(result.images[0].alt).toBe('Logo');
        expect(result.images[1].alt).toBe('Logo (2)');
        expect(result.images[2].alt).toBe('Logo (3)');
        expect(result.body.includes('![Logo](https://a.com/1.jpg)')).toBeTruthy();
        expect(result.body.includes('![Logo (2)](https://a.com/2.jpg)')).toBeTruthy();
        expect(result.body.includes('![Logo (3)](https://a.com/3.jpg)')).toBeTruthy();
      },
    },

    // ─── Same alt, SAME URL: legitimate duplicate, no change ───

    {
      name: 'same-alt-same-url-is-not-a-collision',
      async run({ expect }) {
        const sharedAlt = 'Logo';
        const sharedUrl = 'https://a.com/logo.jpg';
        const images = [
          { src: sharedUrl, alt: sharedAlt, header: false },
          { src: sharedUrl, alt: sharedAlt, header: false },
        ];
        const body = `![${sharedAlt}](${sharedUrl})\n\n![${sharedAlt}](${sharedUrl})`;
        const result = deduplicateImageAlts(images, body);

        expect(result.images[0].alt, 'First image alt unchanged').toBe(sharedAlt);
        expect(result.images[1].alt, 'Second image alt unchanged (same URL)').toBe(sharedAlt);
        expect(result.body, 'Body unchanged when URLs match').toBe(body);
      },
    },

    // ─── Header image is never touched ───

    {
      name: 'header-image-with-shared-alt-is-not-modified',
      async run({ expect }) {
        const sharedAlt = 'banner';
        const images = [
          { src: 'https://a.com/header.jpg', alt: sharedAlt, header: true },
          { src: 'https://a.com/body.jpg', alt: sharedAlt, header: false },
        ];
        const body = `![${sharedAlt}](https://a.com/body.jpg)`;
        const result = deduplicateImageAlts(images, body);

        expect(result.images[0].alt, 'Header image alt unchanged').toBe(sharedAlt);
        expect(result.images[1].alt, 'Body image alt unchanged because header is excluded from collision tracking').toBe(sharedAlt);
        expect(result.body, 'Body unchanged').toBe(body);
      },
    },

    // ─── Mixed scenarios ───

    {
      name: 'mixed-A-B-A-C-only-C-collides-with-A-once',
      async run({ expect }) {
        // Pattern: A, B, A (same URL as first A), C (different URL, same alt as A)
        // Expected: A and A reuse, C gets " (2)" suffix because its alt collides with A.
        const altA = 'Shared';
        const altB = 'Other';
        const urlA = 'https://a.com/a.jpg';
        const urlB = 'https://a.com/b.jpg';
        const urlC = 'https://a.com/c.jpg';

        const images = [
          { src: urlA, alt: altA, header: false },
          { src: urlB, alt: altB, header: false },
          { src: urlA, alt: altA, header: false }, // Same URL as image 1 — legit duplicate
          { src: urlC, alt: altA, header: false }, // Different URL, same alt — collision
        ];
        const body = `![${altA}](${urlA})\n![${altB}](${urlB})\n![${altA}](${urlA})\n![${altA}](${urlC})`;
        const result = deduplicateImageAlts(images, body);

        expect(result.images[0].alt, 'Image 1 unchanged').toBe(altA);
        expect(result.images[1].alt, 'Image 2 (different alt) unchanged').toBe(altB);
        expect(result.images[2].alt, 'Image 3 (same URL as 1) unchanged').toBe(altA);
        expect(result.images[3].alt, 'Image 4 (different URL, same alt) gets " (2)"').toBe(`${altA} (2)`);
        expect(result.body.includes(`![${altA} (2)](${urlC})`), 'Body has the C image with suffixed alt').toBeTruthy();
      },
    },

    // ─── Edge cases ───

    {
      name: 'empty-images-array-returns-empty',
      async run({ expect }) {
        const result = deduplicateImageAlts([], 'some body');
        expect(result.images, 'images is empty').toEqual([]);
        expect(result.body, 'body unchanged').toBe('some body');
      },
    },

    {
      name: 'no-collisions-among-different-alts',
      async run({ expect }) {
        const images = [
          { src: 'https://a.com/1.jpg', alt: 'A', header: false },
          { src: 'https://a.com/2.jpg', alt: 'B', header: false },
          { src: 'https://a.com/3.jpg', alt: 'C', header: false },
        ];
        const body = '![A](https://a.com/1.jpg)\n![B](https://a.com/2.jpg)\n![C](https://a.com/3.jpg)';
        const result = deduplicateImageAlts(images, body);

        expect(result.images[0].alt).toBe('A');
        expect(result.images[1].alt).toBe('B');
        expect(result.images[2].alt).toBe('C');
        expect(result.body, 'Body unchanged').toBe(body);
      },
    },
  ],
});

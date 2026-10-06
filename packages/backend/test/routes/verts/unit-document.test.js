/**
 * Test: the vert unit document backend routes hand out
 *
 * renderVertUnit is a thin mapping onto the ONE renderer in @omega.js/client
 * (modules/vert-document.js) — the same function the client's terminal promo
 * lane calls. These tests cover the mapping (stored vert fields → renderer
 * options), the escaping posture, and the parity itself: no unit template may
 * live in this package.
 *
 * Run: npx omega test backend:routes/verts/unit-document
 */
const fs = require('fs');
const path = require('path');
const { renderVertUnit } = require('../../../dist/omega/routes/verts/utils.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UTILS_PATH = path.join(__dirname, '../../../dist/omega/routes/verts/utils.js');

function makeVert(overrides) {
  return {
    id: 'unit-a',
    enabled: true,
    title: 'Open Vert',
    description: 'A vert with no targeting.',
    button: 'Learn more',
    link: 'https://open-shop.example/products',
    image: '',
    footer: 'Sponsored by Open Shop',
    ...overrides,
  };
}

module.exports = defineCases({
  description: 'Verts unit document (shared renderer)',
  type: 'group',
  tests: [
    {
      name: 'renders-the-media-row-from-the-stored-vert',
      async run({ expect }) {
        const html = await renderVertUnit({
          vert: makeVert(),
          redirectUrl: 'https://api.example/omega/verts/redirect?id=unit-a',
          parentOrigin: 'https://site.example',
          height: 250,
        });

        expect(html.startsWith('<!DOCTYPE html>'), 'Should be a complete document').toBeTruthy();
        expect(html.includes('<span class="omega-vert-title">Open Vert</span>'), 'Title should render').toBeTruthy();
        expect(html.includes('<span class="omega-vert-description">A vert with no targeting.</span>'), 'Description should render').toBeTruthy();
        expect(html.includes('<span class="omega-vert-button">Learn more</span>'), 'Button should render as the cta').toBeTruthy();
        expect(html.includes('<span class="omega-vert-label">Sponsored by Open Shop</span>'), 'Footer should render as the muted label').toBeTruthy();
        expect(html.includes('class="omega-vert-row"'), 'Layout should be the media row').toBeTruthy();
        expect(html.includes('class="omega-vert-rule"'), 'Row and footer should be split by the hairline').toBeTruthy();
        expect(html.includes('href="https://api.example/omega/verts/redirect?id=unit-a"'), 'Link should point at the redirect route').toBeTruthy();
        expect(html.includes('var TARGET_ORIGIN = "https://site.example";'), 'Messages should target the parent origin').toBeTruthy();
        expect(html.includes('var VERT_ID = "unit-a";'), 'Messages should carry the vert id').toBeTruthy();
        expect(!html.includes('height: 250px'), 'The card should be content-sized, not stretched to the slot').toBeTruthy();
      },
    },

    {
      name: 'labels-a-vert-with-no-footer-plainly-sponsored',
      async run({ expect }) {
        const html = await renderVertUnit({ vert: makeVert({ footer: '' }), redirectUrl: 'https://api.example/r' });

        expect(html.includes('<span class="omega-vert-label">Sponsored</span>'), 'Label should fall back to Sponsored').toBeTruthy();
      },
    },

    {
      name: 'image-renders-only-for-http-sources',
      async run({ expect }) {
        const withImage = await renderVertUnit({ vert: makeVert({ image: 'https://cdn.example/a.png' }), redirectUrl: 'https://api.example/r' });
        const withJunk = await renderVertUnit({ vert: makeVert({ image: 'javascript:alert(1)' }), redirectUrl: 'https://api.example/r' });
        const without = await renderVertUnit({ vert: makeVert(), redirectUrl: 'https://api.example/r' });

        expect(withImage.includes('<img class="omega-vert-image" src="https://cdn.example/a.png" alt="">'), 'An http image should render as the thumbnail').toBeTruthy();
        expect(!withJunk.includes('<img'), 'A non-http image source should never render').toBeTruthy();
        expect(!without.includes('<span class="omega-vert-thumb">'), 'No image means no thumbnail slot').toBeTruthy();
      },
    },

    {
      name: 'served-units-keep-the-neutral-ink-accent',
      async run({ expect }) {
        const html = await renderVertUnit({ vert: makeVert(), redirectUrl: 'https://api.example/r' });

        expect(html.includes('--omega-vert-accent: #1a1a1a;'), 'Served units should default to the neutral ink accent').toBeTruthy();
        expect(!html.includes('#4f46e5'), 'The omega indigo belongs to the promo only').toBeTruthy();
      },
    },

    {
      name: 'vert-data-stays-escaped',
      async run({ expect }) {
        const html = await renderVertUnit({
          vert: makeVert({ title: '<script>alert("xss")</script>', description: '"><img src=x onerror=alert(1)>' }),
          redirectUrl: 'https://api.example/r',
        });

        expect(!html.includes('<script>alert'), 'Injected markup should never survive').toBeTruthy();
        expect(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'Title should be escaped').toBeTruthy();
        expect(html.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), 'Description should be escaped').toBeTruthy();
      },
    },

    {
      name: 'no-second-unit-template-lives-in-this-package',
      async run({ expect }) {
        const source = fs.readFileSync(UTILS_PATH, 'utf8');

        expect(!source.includes('<!DOCTYPE'), 'The backend must hold no unit template of its own').toBeTruthy();
        expect(source.includes('@omega.js/client/modules/vert-document.js'), 'The backend should call the one shared renderer').toBeTruthy();
      },
    },
  ],
});

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
const { renderVertUnit } = require('../../../src/manager/routes/verts/utils.js');

const UTILS_PATH = path.join(__dirname, '../../../src/manager/routes/verts/utils.js');

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

module.exports = {
  description: 'Verts unit document (shared renderer)',
  type: 'group',
  tests: [
    {
      name: 'renders-the-media-row-from-the-stored-vert',
      async run({ assert }) {
        const html = await renderVertUnit({
          vert: makeVert(),
          redirectUrl: 'https://api.example/omega/verts/redirect?id=unit-a',
          parentOrigin: 'https://site.example',
          height: 250,
        });

        assert.ok(html.startsWith('<!DOCTYPE html>'), 'Should be a complete document');
        assert.ok(html.includes('<span class="omega-vert-title">Open Vert</span>'), 'Title should render');
        assert.ok(html.includes('<span class="omega-vert-description">A vert with no targeting.</span>'), 'Description should render');
        assert.ok(html.includes('<span class="omega-vert-button">Learn more</span>'), 'Button should render as the cta');
        assert.ok(html.includes('<span class="omega-vert-label">Sponsored by Open Shop</span>'), 'Footer should render as the muted label');
        assert.ok(html.includes('class="omega-vert-row"'), 'Layout should be the media row');
        assert.ok(html.includes('class="omega-vert-rule"'), 'Row and footer should be split by the hairline');
        assert.ok(html.includes('href="https://api.example/omega/verts/redirect?id=unit-a"'), 'Link should point at the redirect route');
        assert.ok(html.includes('var TARGET_ORIGIN = "https://site.example";'), 'Messages should target the parent origin');
        assert.ok(html.includes('var VERT_ID = "unit-a";'), 'Messages should carry the vert id');
        assert.ok(!html.includes('height: 250px'), 'The card should be content-sized, not stretched to the slot');
      },
    },

    {
      name: 'labels-a-vert-with-no-footer-plainly-sponsored',
      async run({ assert }) {
        const html = await renderVertUnit({ vert: makeVert({ footer: '' }), redirectUrl: 'https://api.example/r' });

        assert.ok(html.includes('<span class="omega-vert-label">Sponsored</span>'), 'Label should fall back to Sponsored');
      },
    },

    {
      name: 'image-renders-only-for-http-sources',
      async run({ assert }) {
        const withImage = await renderVertUnit({ vert: makeVert({ image: 'https://cdn.example/a.png' }), redirectUrl: 'https://api.example/r' });
        const withJunk = await renderVertUnit({ vert: makeVert({ image: 'javascript:alert(1)' }), redirectUrl: 'https://api.example/r' });
        const without = await renderVertUnit({ vert: makeVert(), redirectUrl: 'https://api.example/r' });

        assert.ok(withImage.includes('<img class="omega-vert-image" src="https://cdn.example/a.png" alt="">'), 'An http image should render as the thumbnail');
        assert.ok(!withJunk.includes('<img'), 'A non-http image source should never render');
        assert.ok(!without.includes('<span class="omega-vert-thumb">'), 'No image means no thumbnail slot');
      },
    },

    {
      name: 'served-units-keep-the-neutral-ink-accent',
      async run({ assert }) {
        const html = await renderVertUnit({ vert: makeVert(), redirectUrl: 'https://api.example/r' });

        assert.ok(html.includes('--omega-vert-accent: #1a1a1a;'), 'Served units should default to the neutral ink accent');
        assert.ok(!html.includes('#4f46e5'), 'The omega indigo belongs to the promo only');
      },
    },

    {
      name: 'vert-data-stays-escaped',
      async run({ assert }) {
        const html = await renderVertUnit({
          vert: makeVert({ title: '<script>alert("xss")</script>', description: '"><img src=x onerror=alert(1)>' }),
          redirectUrl: 'https://api.example/r',
        });

        assert.ok(!html.includes('<script>alert'), 'Injected markup should never survive');
        assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'Title should be escaped');
        assert.ok(html.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), 'Description should be escaped');
      },
    },

    {
      name: 'no-second-unit-template-lives-in-this-package',
      async run({ assert }) {
        const source = fs.readFileSync(UTILS_PATH, 'utf8');

        assert.ok(!source.includes('<!DOCTYPE'), 'The backend must hold no unit template of its own');
        assert.ok(source.includes('@omega.js/client/modules/vert-document.js'), 'The backend should call the one shared renderer');
      },
    },
  ],
};

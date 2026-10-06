/**
 * Test: content/ghostii.writeArticle() pass-through
 * Verifies that writeArticle() correctly applies overrides and includes sourceContent.
 *
 * Run: npx omega test helpers/content/ghostii-write-article
 *
 * These tests intercept the outgoing HTTP request to verify the API body shape
 * without calling the real Ghostii API. The `wonderful-fetch` call is replaced
 * with a spy that captures and returns the request body.
 */
const path = require('path');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
const ghostiiPath = path.resolve(__dirname, '../../../dist/omega/libraries/content/ghostii.js');

// Capture the request body that writeArticle would send
let capturedBody = null;

function mockFetch(url, opts) {
  capturedBody = opts.body;
  return Promise.resolve(capturedBody);
}

function loadModuleWithMock() {
  // Clear require cache so we get a fresh module
  delete require.cache[ghostiiPath];

  // Temporarily replace wonderful-fetch in the require cache
  const fetchPath = require.resolve('wonderful-fetch');
  const originalFetch = require.cache[fetchPath];
  require.cache[fetchPath] = { id: fetchPath, exports: mockFetch, loaded: true };

  const mod = require(ghostiiPath);

  // Restore original
  if (originalFetch) {
    require.cache[fetchPath] = originalFetch;
  } else {
    delete require.cache[fetchPath];
  }

  return mod;
}

const MOCK_BRAND = {
  brand: { url: 'https://example.com', name: 'TestBrand', id: 'test' },
  repo: { provider: 'github', owner: 'test-user' },
};

module.exports = defineCases({
  description: 'content/ghostii.writeArticle() pass-through',
  type: 'group',

  tests: [
    {
      name: 'defaults-when-no-overrides',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({ brand: MOCK_BRAND, description: 'Test prompt', links: ['https://link.com'] });

        expect(capturedBody, 'request body captured').toBeTruthy();
        expect(capturedBody.keywords, 'default keywords').toEqual([]);
        expect(capturedBody.length, 'default length').toBe('long');
        expect(capturedBody.research, 'default research').toBe(true);
        expect(capturedBody.insertImages, 'default insertImages').toBe(true);
        expect(capturedBody.headerImageUrl, 'default headerImageUrl').toBe('unsplash');
        expect(capturedBody.maxLinks, 'default maxLinks').toBe(6);
        expect(capturedBody.sectionQuantity >= 3 && capturedBody.sectionQuantity <= 6, 'default sectionQuantity in range').toBeTruthy();
        expect(capturedBody.description, 'description passed through').toBe('Test prompt');
        expect(capturedBody.links, 'links passed through').toEqual(['https://link.com']);
        expect(capturedBody.sourceContent, 'no sourceContent by default').toBe(undefined);
      },
    },

    {
      name: 'override-keywords',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          overrides: { keywords: ['AI', 'tech'] },
        });
        expect(capturedBody.keywords).toEqual(['AI', 'tech']);
      },
    },

    {
      name: 'override-length',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          overrides: { length: 'comprehensive' },
        });
        expect(capturedBody.length).toBe('comprehensive');
      },
    },

    {
      name: 'override-research-false',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          overrides: { research: false },
        });
        expect(capturedBody.research).toBe(false);
      },
    },

    {
      name: 'override-insertImages-false',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          overrides: { insertImages: false },
        });
        expect(capturedBody.insertImages).toBe(false);
      },
    },

    {
      name: 'override-insertLinks-false',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          overrides: { insertLinks: false },
        });
        expect(capturedBody.insertLinks).toBe(false);
      },
    },

    {
      name: 'override-headerImageUrl',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          overrides: { headerImageUrl: 'generate' },
        });
        expect(capturedBody.headerImageUrl).toBe('generate');
      },
    },

    {
      name: 'override-maxLinks',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          overrides: { maxLinks: 12 },
        });
        expect(capturedBody.maxLinks).toBe(12);
      },
    },

    {
      name: 'override-sectionQuantity',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          overrides: { sectionQuantity: 8 },
        });
        expect(capturedBody.sectionQuantity).toBe(8);
      },
    },

    {
      name: 'override-feedUrl',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          overrides: { feedUrl: 'https://myblog.com/feed.json' },
        });
        expect(capturedBody.feedUrl).toBe('https://myblog.com/feed.json');
      },
    },

    {
      name: 'sourceContent-included-when-provided',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          sourceContent: 'This is the source article text for rewriting.',
        });
        expect(capturedBody.sourceContent).toBe('This is the source article text for rewriting.');
      },
    },

    {
      name: 'sourceContent-omitted-when-empty',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          sourceContent: '',
        });
        expect(capturedBody.sourceContent, 'empty sourceContent not sent').toBe(undefined);
      },
    },

    {
      name: 'sourceContent-omitted-when-absent',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
        });
        expect(capturedBody.sourceContent, 'missing sourceContent not sent').toBe(undefined);
      },
    },

    {
      name: 'partial-overrides-only-replace-specified',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
          overrides: { length: 'short' },
        });
        expect(capturedBody.length, 'length overridden').toBe('short');
        expect(capturedBody.maxLinks, 'maxLinks keeps default').toBe(6);
        expect(capturedBody.research, 'research keeps default').toBe(true);
        expect(capturedBody.headerImageUrl, 'headerImageUrl keeps default').toBe('unsplash');
      },
    },

    {
      name: 'brand-url-used-in-body',
      async run({ expect }) {
        const { writeArticle } = loadModuleWithMock();
        await writeArticle({
          brand: MOCK_BRAND, description: 'Test', links: [],
        });
        expect(capturedBody.url).toBe('https://example.com');
        expect(capturedBody.feedUrl).toBe('https://example.com/feeds/posts.json');
      },
    },
  ],
});

/**
 * Test: content/ghostii.blocksToPost()
 * Unit tests for the Ghostii-JSON → @omega.js/backend-post transform.
 *
 * Run: npx omega test helpers/content/ghostii-blocks
 *
 * Ghostii is unopinionated about @omega.js/backend: its /write/article response is a generic
 * block array ([{ name, content }], name ∈ heading-1..6/image/paragraph/blockquote/list).
 * blocksToPost() is the SSOT that turns those blocks into what admin/post wants —
 * title + header image as SEPARATE fields, body = content only.
 *
 * Pure function (no I/O) → required directly and called with plain inputs. NOT a mock.
 *
 * Contract:
 *   - title          ← first heading-1 block, leading markdown `#` stripped
 *   - headerImageUrl ← first image block's URL (from `![alt](url)`)
 *   - body           ← every remaining block, joined with blank lines, trimmed
 *   - the title block and the header-image block are EXCLUDED from body
 *   - section images (non-first image blocks) STAY in the body
 *   - non-array / empty input → all empty strings
 */
const { blocksToPost } = require('../../../dist/omega/libraries/content/ghostii.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'content/ghostii.blocksToPost()',
  type: 'group',

  tests: [
    {
      name: 'extracts-title-from-heading-1-stripping-marker',
      async run({ expect }) {
        const result = blocksToPost([
          { name: 'heading-1', content: '# My Great Article' },
          { name: 'paragraph', content: 'Body.' },
        ]);
        expect(result.title).toBe('My Great Article');
      },
    },

    {
      name: 'extracts-header-image-url-from-first-image-block',
      async run({ expect }) {
        const result = blocksToPost([
          { name: 'heading-1', content: '# Title' },
          { name: 'image', content: '![Title](https://images.unsplash.com/photo-abc?w=1080)' },
          { name: 'paragraph', content: 'Body.' },
        ]);
        expect(result.headerImageUrl).toBe('https://images.unsplash.com/photo-abc?w=1080');
      },
    },

    {
      name: 'body-excludes-title-and-header-image',
      async run({ expect }) {
        const result = blocksToPost([
          { name: 'heading-1', content: '# Title' },
          { name: 'image', content: '![Title](https://img/header.jpg)' },
          { name: 'heading-2', content: '## First Section' },
          { name: 'paragraph', content: 'First paragraph.' },
        ]);
        expect(result.body, 'body is content only').toBe('## First Section\n\nFirst paragraph.');
        expect(result.body, 'no H1 title in body').not.toMatch(/^#\s/m);
        expect(result.body, 'no header image in body').not.toMatch(/^!\[Title\]\(https:\/\/img\/header\.jpg\)/m);
      },
    },

    {
      name: 'keeps-section-images-in-body',
      async run({ expect }) {
        const result = blocksToPost([
          { name: 'heading-1', content: '# Title' },
          { name: 'image', content: '![Title](https://img/header.jpg)' },
          { name: 'heading-2', content: '## Section' },
          { name: 'paragraph', content: 'Text.' },
          { name: 'image', content: '![Section](https://img/section.jpg)' },
          { name: 'paragraph', content: 'More text.' },
        ]);
        // Only the FIRST image is the header; later images belong to the body.
        expect(result.body.includes('![Section](https://img/section.jpg)'), 'section image stays in body').toBeTruthy();
        expect((result.body.match(/!\[/g) || []).length, 'exactly one (section) image in body').toBe(1);
      },
    },

    {
      name: 'preserves-blockquotes-and-lists-in-body',
      async run({ expect }) {
        const result = blocksToPost([
          { name: 'heading-1', content: '# Title' },
          { name: 'heading-2', content: '## Section' },
          { name: 'blockquote', content: '> A pithy quote.' },
          { name: 'list', content: '- one\n- two' },
        ]);
        expect(result.body.includes('> A pithy quote.'), 'blockquote kept').toBeTruthy();
        expect(result.body.includes('- one\n- two'), 'list kept').toBeTruthy();
      },
    },

    {
      name: 'handles-missing-heading-1-and-image-gracefully',
      async run({ expect }) {
        const result = blocksToPost([
          { name: 'heading-2', content: '## Only Section' },
          { name: 'paragraph', content: 'Text.' },
        ]);
        expect(result.title, 'no title when no heading-1').toBe('');
        expect(result.headerImageUrl, 'no header image when no image block').toBe('');
        expect(result.body, 'body is all blocks when nothing excluded').toBe('## Only Section\n\nText.');
      },
    },

    {
      name: 'uses-only-the-first-image-as-header',
      async run({ expect }) {
        const result = blocksToPost([
          { name: 'image', content: '![first](https://img/first.jpg)' },
          { name: 'paragraph', content: 'Text.' },
          { name: 'image', content: '![second](https://img/second.jpg)' },
        ]);
        expect(result.headerImageUrl, 'first image is the header').toBe('https://img/first.jpg');
        expect(result.body.includes('https://img/second.jpg'), 'second image stays in body').toBeTruthy();
        expect(!result.body.includes('https://img/first.jpg'), 'first image not in body').toBeTruthy();
      },
    },

    {
      name: 'non-array-or-empty-input-returns-empty-strings',
      async run({ expect }) {
        expect(blocksToPost([]), 'empty array').toEqual({ title: '', headerImageUrl: '', body: '' });
        expect(blocksToPost(null), 'null').toEqual({ title: '', headerImageUrl: '', body: '' });
        expect(blocksToPost(undefined), 'undefined').toEqual({ title: '', headerImageUrl: '', body: '' });
      },
    },
  ],
});

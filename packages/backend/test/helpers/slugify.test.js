/**
 * Test: services/utilities.slugify()
 * Unit tests for the canonical URL slug builder.
 *
 * Run: npx omega test helpers/slugify
 *
 * slugify is the SSOT used by:
 *   - @omega.js/backend admin/post (legacy + modern) for URL + image filenames
 *   - Sponsorship platform validator.buildFormatted()
 *
 * Contract:
 *   - Strip all non-alphanumeric characters → replace with `-`
 *   - Collapse runs of `-` into a single `-`
 *   - Trim leading/trailing `-`
 *   - Lowercase the result
 *   - Non-string input → empty string
 */
const Utilities = require('../../dist/omega/services/utilities.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const omega = { firebase: {} };
const utilities = new Utilities(omega);

module.exports = defineCases({
  description: 'Utilities.slugify()',
  type: 'group',

  tests: [
    // ─── Basic happy path ───

    {
      name: 'lowercases-simple-string',
      async run({ expect }) {
        expect(utilities.slugify('Hello World')).toBe('hello-world');
      },
    },

    {
      name: 'preserves-numbers',
      async run({ expect }) {
        expect(utilities.slugify('Top 10 Products 2025')).toBe('top-10-products-2025');
      },
    },

    {
      name: 'already-a-slug-passes-through',
      async run({ expect }) {
        expect(utilities.slugify('already-a-slug')).toBe('already-a-slug');
      },
    },

    {
      name: 'single-word-unchanged',
      async run({ expect }) {
        expect(utilities.slugify('hello')).toBe('hello');
      },
    },

    // ─── The bug that drove this: collapse runs of `-` ───

    {
      name: 'collapses-double-dashes-from-literal-hyphen-space',
      async run({ expect }) {
        // The real-world example: "Copy- Paste" produced "copy--paste" before the fix
        expect(utilities.slugify('AI Study Prompts That Work: Copy- Paste Questions for Every Subject')).toBe('ai-study-prompts-that-work-copy-paste-questions-for-every-subject');
      },
    },

    {
      name: 'collapses-many-consecutive-dashes',
      async run({ expect }) {
        expect(utilities.slugify('foo---bar')).toBe('foo-bar');
        expect(utilities.slugify('foo-----bar')).toBe('foo-bar');
      },
    },

    {
      name: 'collapses-mixed-runs-of-special-chars',
      async run({ expect }) {
        // " / - / " → multiple non-alphanum → all become one `-`
        expect(utilities.slugify('foo / - / bar')).toBe('foo-bar');
      },
    },

    // ─── Leading/trailing trim ───

    {
      name: 'strips-leading-and-trailing-spaces',
      async run({ expect }) {
        expect(utilities.slugify('  hello world  ')).toBe('hello-world');
      },
    },

    {
      name: 'strips-leading-and-trailing-dashes',
      async run({ expect }) {
        expect(utilities.slugify('---hello---')).toBe('hello');
      },
    },

    {
      name: 'strips-leading-slash',
      async run({ expect }) {
        expect(utilities.slugify('/foo/bar')).toBe('foo-bar');
      },
    },

    {
      name: 'strips-trailing-slash',
      async run({ expect }) {
        expect(utilities.slugify('foo/bar/')).toBe('foo-bar');
      },
    },

    {
      name: 'strips-both-slashes',
      async run({ expect }) {
        expect(utilities.slugify('/foo/bar/')).toBe('foo-bar');
      },
    },

    // ─── Punctuation ───

    {
      name: 'colon-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('Title: Subtitle')).toBe('title-subtitle');
      },
    },

    {
      name: 'comma-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('one, two, three')).toBe('one-two-three');
      },
    },

    {
      name: 'question-mark-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('What is AI?')).toBe('what-is-ai');
      },
    },

    {
      name: 'exclamation-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('Hello World!')).toBe('hello-world');
      },
    },

    {
      name: 'period-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('v1.2.3')).toBe('v1-2-3');
      },
    },

    {
      name: 'apostrophe-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify("don't stop")).toBe('don-t-stop');
      },
    },

    {
      name: 'quotes-become-dashes',
      async run({ expect }) {
        expect(utilities.slugify('"Hello" said the dog')).toBe('hello-said-the-dog');
      },
    },

    {
      name: 'parens-become-dashes',
      async run({ expect }) {
        expect(utilities.slugify('Function (advanced)')).toBe('function-advanced');
      },
    },

    {
      name: 'brackets-become-dashes',
      async run({ expect }) {
        expect(utilities.slugify('Array[0] access')).toBe('array-0-access');
      },
    },

    {
      name: 'ampersand-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('Salt & Pepper')).toBe('salt-pepper');
      },
    },

    {
      name: 'hash-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('issue #42')).toBe('issue-42');
      },
    },

    {
      name: 'at-sign-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('user@example.com')).toBe('user-example-com');
      },
    },

    // ─── Unicode / non-ASCII ───

    {
      name: 'em-dash-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('Title — Subtitle')).toBe('title-subtitle');
      },
    },

    {
      name: 'curly-quotes-become-dashes',
      async run({ expect }) {
        expect(utilities.slugify('“Hello”')).toBe('hello');
      },
    },

    {
      name: 'emoji-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('Rocket 🚀 launch')).toBe('rocket-launch');
      },
    },

    {
      name: 'accented-chars-become-dashes',
      async run({ expect }) {
        // Slugify is ASCII-only by design — accents get stripped to dashes
        // (Future improvement could be to transliterate, but current behavior is documented here)
        expect(utilities.slugify('café')).toBe('caf');
      },
    },

    // ─── Whitespace variants ───

    {
      name: 'tab-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('foo\tbar')).toBe('foo-bar');
      },
    },

    {
      name: 'newline-becomes-dash',
      async run({ expect }) {
        expect(utilities.slugify('foo\nbar')).toBe('foo-bar');
      },
    },

    {
      name: 'multiple-spaces-collapse',
      async run({ expect }) {
        expect(utilities.slugify('foo    bar')).toBe('foo-bar');
      },
    },

    {
      name: 'mixed-whitespace-collapses',
      async run({ expect }) {
        expect(utilities.slugify('foo \t \n bar')).toBe('foo-bar');
      },
    },

    // ─── Edge cases / non-string input ───

    {
      name: 'empty-string-returns-empty',
      async run({ expect }) {
        expect(utilities.slugify('')).toBe('');
      },
    },

    {
      name: 'all-punctuation-returns-empty',
      async run({ expect }) {
        expect(utilities.slugify('!@#$%^&*()')).toBe('');
      },
    },

    {
      name: 'only-dashes-returns-empty',
      async run({ expect }) {
        expect(utilities.slugify('-----')).toBe('');
      },
    },

    {
      name: 'only-whitespace-returns-empty',
      async run({ expect }) {
        expect(utilities.slugify('   ')).toBe('');
      },
    },

    {
      name: 'null-returns-empty-string',
      async run({ expect }) {
        expect(utilities.slugify(null)).toBe('');
      },
    },

    {
      name: 'undefined-returns-empty-string',
      async run({ expect }) {
        expect(utilities.slugify(undefined)).toBe('');
      },
    },

    {
      name: 'number-returns-empty-string',
      async run({ expect }) {
        // Non-string input → empty string (caller is responsible for stringifying)
        expect(utilities.slugify(42)).toBe('');
      },
    },

    {
      name: 'object-returns-empty-string',
      async run({ expect }) {
        expect(utilities.slugify({ foo: 'bar' })).toBe('');
      },
    },

    {
      name: 'array-returns-empty-string',
      async run({ expect }) {
        expect(utilities.slugify(['hello'])).toBe('');
      },
    },

    // ─── Real-world examples ───

    {
      name: 'real-blog-post-title',
      async run({ expect }) {
        expect(utilities.slugify('10 Best Productivity Apps for Students in 2025')).toBe('10-best-productivity-apps-for-students-in-2025');
      },
    },

    {
      name: 'real-blog-post-with-colon-and-slash',
      async run({ expect }) {
        expect(utilities.slugify('Beginner\'s Guide: Python vs JavaScript')).toBe('beginner-s-guide-python-vs-javascript');
      },
    },

    {
      name: 'real-image-alt-text',
      async run({ expect }) {
        // The downloadImage() caller uses slugify(alt) to build a tmp filename
        expect(utilities.slugify('Diagram showing the user flow (v2)')).toBe('diagram-showing-the-user-flow-v2');
      },
    },

    {
      name: 'real-url-with-blog-prefix-removed-first',
      async run({ expect }) {
        // Mimics how callers strip "blog/" before slugifying
        const url = 'blog/some-existing-post';
        expect(utilities.slugify(url.replace(/blog\//ig, ''))).toBe('some-existing-post');
      },
    },

    // ─── Idempotency ───

    {
      name: 'idempotent-double-slugify',
      async run({ expect }) {
        const once = utilities.slugify('Hello World: Foo & Bar!');
        const twice = utilities.slugify(once);
        expect(twice, 'Applying slugify twice should equal applying it once').toBe(once);
      },
    },
  ],
});

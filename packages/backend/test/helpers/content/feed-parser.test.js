/**
 * Test: content/feed-parser
 * Unit tests for the RSS 2.0, Atom 1.0, and JSON Feed parser + article content extractor.
 *
 * Run: npx omega test helpers/content/feed-parser
 *
 * Pure function tests (parseFeed, stripHtml, extractElement) — required
 * directly and called with plain inputs. NOT a mock.
 */
const { parseFeed, stripHtml, extractTextFromHtml } = require('../../../dist/omega/libraries/content/feed-parser.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

// --- Sample feeds for testing ---

const RSS_FULL = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Tech News</title>
    <link>https://example.com</link>
    <description>Latest tech news</description>
    <item>
      <guid>https://example.com/article-1</guid>
      <title>First Article Title</title>
      <link>https://example.com/article-1</link>
      <description>Short description of the first article.</description>
      <content:encoded><![CDATA[<p>Full content of the first article with <strong>HTML</strong> formatting.</p>]]></content:encoded>
      <pubDate>Mon, 16 Jun 2025 10:00:00 GMT</pubDate>
      <dc:creator>Jane Doe</dc:creator>
    </item>
    <item>
      <guid isPermaLink="false">article-2-id</guid>
      <title>Second Article Title</title>
      <link>https://example.com/article-2</link>
      <description>Short description of the second article.</description>
      <pubDate>Tue, 17 Jun 2025 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const RSS_MINIMAL = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Minimal</title>
    <item>
      <title>Only Title</title>
      <link>https://example.com/only</link>
    </item>
  </channel>
</rss>`;

const RSS_EMPTY_CHANNEL = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Empty</title>
  </channel>
</rss>`;

const ATOM_FULL = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <id>urn:uuid:entry-1</id>
    <title>Atom Entry One</title>
    <link rel="alternate" href="https://example.com/atom-1"/>
    <link rel="enclosure" href="https://example.com/atom-1.mp3"/>
    <summary>Summary of entry one.</summary>
    <content>Full content of entry one.</content>
    <published>2025-06-16T10:00:00Z</published>
  </entry>
  <entry>
    <id>urn:uuid:entry-2</id>
    <title type="html">Atom Entry &amp; Two</title>
    <link href="https://example.com/atom-2"/>
    <updated>2025-06-17T12:00:00Z</updated>
  </entry>
</feed>`;

const ATOM_EMPTY = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Empty Atom</title>
</feed>`;

const JSON_FEED = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'JSON Feed',
  items: [
    {
      id: 'json-1',
      title: 'JSON Article One',
      url: 'https://example.com/json-1',
      summary: 'Short summary.',
      content_html: '<p>Full HTML content.</p>',
      content_text: 'Full text content.',
      date_published: '2025-06-16T10:00:00Z',
    },
    {
      id: 'json-2',
      title: 'JSON Article Two',
      url: 'https://example.com/json-2',
      content_text: 'Second article text.',
      date_modified: '2025-06-17T12:00:00Z',
    },
  ],
});

const RSSAPP_FORMAT = JSON.stringify({
  items: [
    {
      title: 'RSS.app Item',
      url: 'https://example.com/rssapp-1',
      content_text: 'Content from RSS.app feed.',
    },
  ],
});

module.exports = defineCases({
  description: 'content/feed-parser',
  type: 'group',

  tests: [
    // ============================
    // RSS 2.0 PARSING
    // ============================
    {
      name: 'rss-parses-standard-items',
      async run({ expect }) {
        const { items } = parseFeed(RSS_FULL);
        expect(items.length, 'should parse 2 items').toBe(2);
        expect(items[0].title).toBe('First Article Title');
        expect(items[1].title).toBe('Second Article Title');
      },
    },

    {
      name: 'rss-extracts-guid-as-id',
      async run({ expect }) {
        const { items } = parseFeed(RSS_FULL);
        expect(items[0].id, 'text guid').toBe('https://example.com/article-1');
        expect(items[1].id, 'guid with isPermaLink attr').toBe('article-2-id');
      },
    },

    {
      name: 'rss-extracts-link-as-url',
      async run({ expect }) {
        const { items } = parseFeed(RSS_FULL);
        expect(items[0].url).toBe('https://example.com/article-1');
        expect(items[1].url).toBe('https://example.com/article-2');
      },
    },

    {
      name: 'rss-extracts-description-as-summary',
      async run({ expect }) {
        const { items } = parseFeed(RSS_FULL);
        expect(items[0].summary).toBe('Short description of the first article.');
      },
    },

    {
      name: 'rss-extracts-content-encoded-as-content',
      async run({ expect }) {
        const { items } = parseFeed(RSS_FULL);
        expect(items[0].content.includes('Full content of the first article'), 'has content:encoded text').toBeTruthy();
        expect(!items[0].content.includes('<p>'), 'HTML stripped from content').toBeTruthy();
      },
    },

    {
      name: 'rss-falls-back-to-description-when-no-content-encoded',
      async run({ expect }) {
        const { items } = parseFeed(RSS_FULL);
        expect(items[1].content).toBe('Short description of the second article.');
      },
    },

    {
      name: 'rss-extracts-pubdate',
      async run({ expect }) {
        const { items } = parseFeed(RSS_FULL);
        expect(items[0].publishedAt).toBe('Mon, 16 Jun 2025 10:00:00 GMT');
      },
    },

    {
      name: 'rss-handles-missing-optional-fields',
      async run({ expect }) {
        const { items } = parseFeed(RSS_MINIMAL);
        expect(items.length).toBe(1);
        expect(items[0].title).toBe('Only Title');
        expect(items[0].url).toBe('https://example.com/only');
        expect(items[0].summary, 'no description').toBe('');
        expect(items[0].publishedAt, 'no pubDate').toBe('');
      },
    },

    {
      name: 'rss-preserves-item-order',
      async run({ expect }) {
        const { items } = parseFeed(RSS_FULL);
        expect(items[0].title, 'first item is first').toBe('First Article Title');
        expect(items[1].title, 'second item is second').toBe('Second Article Title');
      },
    },

    {
      name: 'rss-empty-channel-returns-empty-items',
      async run({ expect }) {
        const { items } = parseFeed(RSS_EMPTY_CHANNEL);
        expect(items.length).toBe(0);
      },
    },

    // ============================
    // ATOM 1.0 PARSING
    // ============================
    {
      name: 'atom-parses-standard-entries',
      async run({ expect }) {
        const { items } = parseFeed(ATOM_FULL);
        expect(items.length, 'should parse 2 entries').toBe(2);
        expect(items[0].title).toBe('Atom Entry One');
      },
    },

    {
      name: 'atom-extracts-id',
      async run({ expect }) {
        const { items } = parseFeed(ATOM_FULL);
        expect(items[0].id).toBe('urn:uuid:entry-1');
        expect(items[1].id).toBe('urn:uuid:entry-2');
      },
    },

    {
      name: 'atom-picks-alternate-link-href',
      async run({ expect }) {
        const { items } = parseFeed(ATOM_FULL);
        expect(items[0].url, 'picks rel=alternate over enclosure').toBe('https://example.com/atom-1');
      },
    },

    {
      name: 'atom-falls-back-to-first-link-when-no-rel',
      async run({ expect }) {
        const { items } = parseFeed(ATOM_FULL);
        expect(items[1].url, 'link without rel').toBe('https://example.com/atom-2');
      },
    },

    {
      name: 'atom-extracts-summary-and-content',
      async run({ expect }) {
        const { items } = parseFeed(ATOM_FULL);
        expect(items[0].summary).toBe('Summary of entry one.');
        expect(items[0].content).toBe('Full content of entry one.');
      },
    },

    {
      name: 'atom-extracts-published-or-updated',
      async run({ expect }) {
        const { items } = parseFeed(ATOM_FULL);
        expect(items[0].publishedAt, 'published').toBe('2025-06-16T10:00:00Z');
        expect(items[1].publishedAt, 'updated fallback').toBe('2025-06-17T12:00:00Z');
      },
    },

    {
      name: 'atom-empty-feed-returns-empty-items',
      async run({ expect }) {
        const { items } = parseFeed(ATOM_EMPTY);
        expect(items.length).toBe(0);
      },
    },

    // ============================
    // JSON FEED PARSING
    // ============================
    {
      name: 'json-parses-standard-items',
      async run({ expect }) {
        const { items } = parseFeed(JSON_FEED);
        expect(items.length).toBe(2);
        expect(items[0].title).toBe('JSON Article One');
        expect(items[1].title).toBe('JSON Article Two');
      },
    },

    {
      name: 'json-extracts-id-and-url',
      async run({ expect }) {
        const { items } = parseFeed(JSON_FEED);
        expect(items[0].id).toBe('json-1');
        expect(items[0].url).toBe('https://example.com/json-1');
      },
    },

    {
      name: 'json-prefers-content-html-over-content-text',
      async run({ expect }) {
        const { items } = parseFeed(JSON_FEED);
        expect(items[0].content).toBe('<p>Full HTML content.</p>');
      },
    },

    {
      name: 'json-falls-back-to-content-text',
      async run({ expect }) {
        const { items } = parseFeed(JSON_FEED);
        expect(items[1].content).toBe('Second article text.');
      },
    },

    {
      name: 'json-extracts-dates',
      async run({ expect }) {
        const { items } = parseFeed(JSON_FEED);
        expect(items[0].publishedAt, 'date_published').toBe('2025-06-16T10:00:00Z');
        expect(items[1].publishedAt, 'date_modified fallback').toBe('2025-06-17T12:00:00Z');
      },
    },

    {
      name: 'json-handles-rssapp-format',
      async run({ expect }) {
        const { items } = parseFeed(RSSAPP_FORMAT);
        expect(items.length).toBe(1);
        expect(items[0].title).toBe('RSS.app Item');
        expect(items[0].content).toBe('Content from RSS.app feed.');
      },
    },

    {
      name: 'json-empty-items-returns-empty',
      async run({ expect }) {
        const { items } = parseFeed(JSON.stringify({ items: [] }));
        expect(items.length).toBe(0);
      },
    },

    // ============================
    // EDGE CASES
    // ============================
    {
      name: 'returns-empty-for-null-input',
      async run({ expect }) {
        expect(parseFeed(null)).toEqual({ items: [] });
      },
    },

    {
      name: 'returns-empty-for-undefined-input',
      async run({ expect }) {
        expect(parseFeed(undefined)).toEqual({ items: [] });
      },
    },

    {
      name: 'returns-empty-for-empty-string',
      async run({ expect }) {
        expect(parseFeed('')).toEqual({ items: [] });
      },
    },

    {
      name: 'returns-empty-for-invalid-xml',
      async run({ expect }) {
        const { items } = parseFeed('<not<valid>xml');
        expect(items.length).toBe(0);
      },
    },

    {
      name: 'returns-empty-for-non-feed-json',
      async run({ expect }) {
        const { items } = parseFeed(JSON.stringify({ data: [1, 2, 3] }));
        expect(items.length).toBe(0);
      },
    },

    {
      name: 'returns-empty-for-plain-text',
      async run({ expect }) {
        const { items } = parseFeed('just some plain text content');
        expect(items.length).toBe(0);
      },
    },

    {
      name: 'handles-bom-prefix',
      async run({ expect }) {
        const withBom = '﻿' + RSS_MINIMAL;
        const { items } = parseFeed(withBom);
        expect(items.length, 'BOM does not break parsing').toBe(1);
        expect(items[0].title).toBe('Only Title');
      },
    },

    {
      name: 'handles-namespace-prefixed-elements',
      async run({ expect }) {
        const { items } = parseFeed(RSS_FULL);
        expect(items[0].content.includes('Full content'), 'content:encoded parsed despite namespace').toBeTruthy();
      },
    },

    {
      name: 'truncates-long-content',
      async run({ expect }) {
        const longContent = 'x'.repeat(20000);
        const feed = JSON.stringify({
          items: [{ id: '1', title: 'Long', url: 'https://example.com', content_text: longContent }],
        });
        const { items } = parseFeed(feed);
        expect(items[0].content.length <= 1024 * 14, 'content truncated to 14KB').toBeTruthy();
      },
    },

    {
      name: 'truncates-long-summary',
      async run({ expect }) {
        const longSummary = 'y'.repeat(1000);
        const feed = JSON.stringify({
          items: [{ id: '1', title: 'Long Summary', url: 'https://example.com', summary: longSummary }],
        });
        const { items } = parseFeed(feed);
        expect(items[0].summary.length <= 500, 'summary truncated to 500 chars').toBeTruthy();
      },
    },

    // ============================
    // STRIP HTML
    // ============================
    {
      name: 'stripHtml-removes-tags',
      async run({ expect }) {
        expect(stripHtml('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
      },
    },

    {
      name: 'stripHtml-normalizes-whitespace',
      async run({ expect }) {
        expect(stripHtml('<p>Hello</p>   <p>World</p>')).toBe('Hello World');
      },
    },

    {
      name: 'stripHtml-handles-empty-string',
      async run({ expect }) {
        expect(stripHtml('')).toBe('');
      },
    },

    // ============================
    // EXTRACT TEXT FROM HTML (Cheerio)
    // ============================
    {
      name: 'extractTextFromHtml-extracts-from-article-tag',
      async run({ expect }) {
        const html = '<html><body><nav>Menu</nav><article class="post"><p>Article content</p></article><footer>Footer</footer></body></html>';
        const text = extractTextFromHtml(html);
        expect(text.includes('Article content'), 'extracts article text').toBeTruthy();
        expect(!text.includes('Menu'), 'nav removed').toBeTruthy();
        expect(!text.includes('Footer'), 'footer removed').toBeTruthy();
      },
    },

    {
      name: 'extractTextFromHtml-falls-back-to-main',
      async run({ expect }) {
        const html = '<html><body><main><p>Main content</p></main><aside>Sidebar</aside></body></html>';
        const text = extractTextFromHtml(html);
        expect(text.includes('Main content'), 'extracts main text').toBeTruthy();
        expect(!text.includes('Sidebar'), 'aside removed').toBeTruthy();
      },
    },

    {
      name: 'extractTextFromHtml-falls-back-to-body',
      async run({ expect }) {
        const html = '<html><body><p>Body content here</p></body></html>';
        const text = extractTextFromHtml(html);
        expect(text.includes('Body content here'), 'extracts body text').toBeTruthy();
      },
    },

    {
      name: 'extractTextFromHtml-strips-scripts-and-styles',
      async run({ expect }) {
        const html = '<html><body><article><script>alert("xss")</script><style>.x{color:red}</style><p>Clean text</p></article></body></html>';
        const text = extractTextFromHtml(html);
        expect(text.includes('Clean text'), 'keeps article text').toBeTruthy();
        expect(!text.includes('alert'), 'script removed').toBeTruthy();
        expect(!text.includes('color'), 'style removed').toBeTruthy();
      },
    },

    {
      name: 'extractTextFromHtml-strips-forms-and-buttons',
      async run({ expect }) {
        const html = '<html><body><article><p>Article text</p><form><input placeholder="Email"><button>Subscribe</button></form></article></body></html>';
        const text = extractTextFromHtml(html);
        expect(text.includes('Article text'), 'keeps article text').toBeTruthy();
        expect(!text.includes('Subscribe'), 'button removed').toBeTruthy();
      },
    },

    {
      name: 'extractTextFromHtml-strips-ad-classes',
      async run({ expect }) {
        const html = '<html><body><article><p>Real content</p><div class="advertisement">Buy stuff</div><div class="social-share">Share this</div></article></body></html>';
        const text = extractTextFromHtml(html);
        expect(text.includes('Real content'), 'keeps article text').toBeTruthy();
        expect(!text.includes('Buy stuff'), 'ad removed').toBeTruthy();
        expect(!text.includes('Share this'), 'social share removed').toBeTruthy();
      },
    },

    {
      name: 'extractTextFromHtml-returns-empty-for-empty-html',
      async run({ expect }) {
        expect(extractTextFromHtml('')).toBe('');
        expect(extractTextFromHtml('<html><body></body></html>')).toBe('');
      },
    },
  ],
});

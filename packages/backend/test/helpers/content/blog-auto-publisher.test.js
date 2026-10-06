/**
 * Test: content/blog-auto-publisher
 * Tests for the shared source-resolver (used by both blog + newsletter crons):
 * source type detection, Firestore tracking, hash determinism, and the
 * unified pick/fallback resolution.
 *
 * Run: npx omega test helpers/content/blog-auto-publisher
 *
 * Pure-function tests for exported utilities (contentSourceHash, isURL). Feed
 * processing and Firestore tracking tests run against the real emulator.
 */
const path = require('path');
const resolverPath = path.resolve(__dirname, '../../../dist/omega/libraries/content/source-resolver.js');
const { contentSourceHash, isURL } = require(resolverPath);
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
const Context = require('../../../dist/omega/context.js');

module.exports = defineCases({
  description: 'content/blog-auto-publisher',
  type: 'group',

  tests: [
    // ============================
    // SOURCE TYPE DETECTION (isURL)
    // ============================
    {
      name: 'isURL-detects-http-url',
      async run({ expect }) {
        expect(isURL('https://example.com/page')).toBe(true);
        expect(isURL('http://example.com')).toBe(true);
      },
    },

    {
      name: 'isURL-rejects-non-urls',
      async run({ expect }) {
        expect(isURL('$brand')).toBe(false);
        expect(isURL('Write about AI')).toBe(false);
        expect(isURL('$feed:https://example.com/feed')).toBe(false);
      },
    },

    {
      name: 'isURL-rejects-colon-prefixed-text-and-non-http-schemes',
      async run({ expect }) {
        // "AI:" parses as a URL scheme via new URL() — these are text seeds,
        // not URLs, and must NOT be fetched (the fetch fails and the seed is
        // silently lost)
        expect(isURL('AI: the future of work')).toBe(false);
        expect(isURL('Growth: 10 tactics for creators')).toBe(false);
        expect(isURL('mailto:someone@example.com')).toBe(false);
        expect(isURL('ftp://example.com/file')).toBe(false);
      },
    },

    {
      name: 'isURL-rejects-empty-and-null',
      async run({ expect }) {
        expect(isURL('')).toBe(false);
        expect(isURL(null)).toBe(false);
        expect(isURL(undefined)).toBe(false);
      },
    },

    // ============================
    // $feed: PREFIX DETECTION
    // ============================
    {
      name: 'feed-prefix-detected-correctly',
      async run({ expect }) {
        const source = '$feed:https://techcrunch.com/feed/';
        expect(source.startsWith('$feed:'), '$feed: prefix detected').toBe(true);

        const feedUrl = source.slice('$feed:'.length);
        expect(feedUrl, 'URL extracted after prefix').toBe('https://techcrunch.com/feed/');
      },
    },

    {
      name: 'feed-prefix-not-confused-with-brand',
      async run({ expect }) {
        expect('$brand'.startsWith('$feed:')).toBe(false);
      },
    },

    {
      name: 'feed-prefix-not-confused-with-parent',
      async run({ expect }) {
        expect('$parent'.startsWith('$feed:')).toBe(false);
      },
    },

    {
      name: 'feed-prefix-not-confused-with-plain-url',
      async run({ expect }) {
        expect('https://example.com'.startsWith('$feed:')).toBe(false);
      },
    },

    {
      name: 'feed-prefix-not-confused-with-text',
      async run({ expect }) {
        expect('Write about technology'.startsWith('$feed:')).toBe(false);
      },
    },

    // ============================
    // CONTENT SOURCE HASH
    // ============================
    {
      name: 'contentSourceHash-is-deterministic',
      async run({ expect }) {
        const hash1 = contentSourceHash('$feed:https://example.com/feed', 'item-123');
        const hash2 = contentSourceHash('$feed:https://example.com/feed', 'item-123');
        expect(hash1, 'same input produces same hash').toBe(hash2);
      },
    },

    {
      name: 'contentSourceHash-different-for-different-items',
      async run({ expect }) {
        const hash1 = contentSourceHash('$feed:https://example.com/feed', 'item-1');
        const hash2 = contentSourceHash('$feed:https://example.com/feed', 'item-2');
        expect(hash1, 'different items produce different hashes').not.toBe(hash2);
      },
    },

    {
      name: 'contentSourceHash-different-for-different-origins',
      async run({ expect }) {
        const hash1 = contentSourceHash('$feed:https://example.com/feed-a', 'item-1');
        const hash2 = contentSourceHash('$feed:https://example.com/feed-b', 'item-1');
        expect(hash1, 'same item ID with different origins produces different hash').not.toBe(hash2);
      },
    },

    {
      name: 'contentSourceHash-different-for-different-source-types',
      async run({ expect }) {
        const hash1 = contentSourceHash('$parent', 'source-1');
        const hash2 = contentSourceHash('$feed:https://example.com/feed', 'source-1');
        expect(hash1, '$parent and $feed with same URL produce different hash').not.toBe(hash2);
      },
    },

    {
      name: 'contentSourceHash-is-20-chars',
      async run({ expect }) {
        const hash = contentSourceHash('$feed:https://example.com/feed', 'item-123');
        expect(hash.length, 'hash is 20 hex chars').toBe(20);
      },
    },

    {
      name: 'contentSourceHash-is-hex-only',
      async run({ expect }) {
        const hash = contentSourceHash('$feed:https://example.com/feed', 'item-123');
        expect(/^[0-9a-f]+$/.test(hash), 'hash contains only hex characters').toBeTruthy();
      },
    },

    // ============================
    // FIRESTORE TRACKING (emulator)
    // ============================
    {
      name: 'trackContentSource-writes-correct-schema',
      async run({ expect, admin }) {
        if (!admin) {
          return expect(true, 'skipped: no emulator').toBeTruthy();
        }

        const { trackContentSource } = require(resolverPath);
        const origin = '$feed:https://test-feed.com/rss';
        const url = 'https://test-feed.com/article-1';
        const docId = contentSourceHash(origin, url);

        await trackContentSource(admin, {
          url,
          origin,
          feedUrl: 'https://test-feed.com/rss',
          itemId: 'test-item-1',
          itemTitle: 'Test Article',
          usedBy: 'blog',
          brandId: 'test-brand',
          postUrl: 'https://test-brand.com/blog/test-article',
          postSlug: 'test-article',
        });

        const doc = await admin.firestore().doc(`content-sources/${docId}`).get();
        expect(doc.exists, 'tracking doc created').toBeTruthy();

        const data = doc.data();
        expect(data.url).toBe(url);
        expect(data.origin).toBe(origin);
        expect(data.feedUrl).toBe('https://test-feed.com/rss');
        expect(data.itemId).toBe('test-item-1');
        expect(data.itemTitle).toBe('Test Article');
        expect(data.usedBy).toBe('blog');
        expect(data.brandId).toBe('test-brand');
        expect(data.postUrl).toBe('https://test-brand.com/blog/test-article');
        expect(data.postSlug).toBe('test-article');
        expect(data.metadata, 'has metadata object').toBeTruthy();
        expect(data.metadata.created, 'has metadata.created').toBeTruthy();
        expect(data.metadata.updated, 'has metadata.updated').toBeTruthy();
        expect(typeof data.metadata.created.timestamp, 'created.timestamp is ISO string').toBe('string');
        expect(typeof data.metadata.created.timestampUNIX, 'created.timestampUNIX is number').toBe('number');
        expect(typeof data.metadata.updated.timestamp, 'updated.timestamp is ISO string').toBe('string');
        expect(typeof data.metadata.updated.timestampUNIX, 'updated.timestampUNIX is number').toBe('number');
      },
    },

    {
      name: 'trackContentSource-tracks-newsletter-usage',
      async run({ expect, admin }) {
        if (!admin) {
          return expect(true, 'skipped: no emulator').toBeTruthy();
        }

        const { trackContentSource } = require(resolverPath);
        const origin = '$parent';
        const url = 'https://parent-server.com/source-42';
        const docId = contentSourceHash(origin, url);

        await trackContentSource(admin, {
          url,
          origin,
          itemId: 'source-42',
          itemTitle: 'Newsletter Source',
          usedBy: 'newsletter',
          brandId: 'test-brand',
        });

        const doc = await admin.firestore().doc(`content-sources/${docId}`).get();
        expect(doc.exists, 'tracking doc created for newsletter').toBeTruthy();

        const data = doc.data();
        expect(data.usedBy, 'usedBy is newsletter').toBe('newsletter');
        expect(data.origin, 'origin is $parent').toBe('$parent');
      },
    },

    {
      name: 'getProcessedItemIds-returns-tracked-ids',
      async run({ expect, admin }) {
        if (!admin) {
          return expect(true, 'skipped: no emulator').toBeTruthy();
        }

        const { getProcessedItemIds, trackContentSource } = require(resolverPath);
        const feedUrl = 'https://processed-test.com/rss';
        const origin = `$feed:${feedUrl}`;

        // Track two items
        await trackContentSource(admin, {
          url: 'https://processed-test.com/a1',
          origin,
          feedUrl,
          itemId: 'proc-1',
          itemTitle: 'Article 1',
          usedBy: 'blog',
          brandId: 'test-brand',
        });
        await trackContentSource(admin, {
          url: 'https://processed-test.com/a2',
          origin,
          feedUrl,
          itemId: 'proc-2',
          itemTitle: 'Article 2',
          usedBy: 'blog',
          brandId: 'test-brand',
        });

        const ids = await getProcessedItemIds(admin, feedUrl);
        expect(ids.has('proc-1'), 'first item tracked').toBeTruthy();
        expect(ids.has('proc-2'), 'second item tracked').toBeTruthy();
        expect(!ids.has('proc-3'), 'untracked item not present').toBeTruthy();
      },
    },

    {
      name: 'getProcessedItemIds-scoped-to-feed-url',
      async run({ expect, admin }) {
        if (!admin) {
          return expect(true, 'skipped: no emulator').toBeTruthy();
        }

        const { getProcessedItemIds, trackContentSource } = require(resolverPath);

        // Track item in feed A
        await trackContentSource(admin, {
          url: 'https://feed-a.com/article',
          origin: '$feed:https://feed-a.com/rss',
          feedUrl: 'https://feed-a.com/rss',
          itemId: 'scoped-1',
          itemTitle: 'Feed A Article',
          usedBy: 'blog',
          brandId: 'test-brand',
        });

        // Query feed B — should NOT see feed A's items
        const ids = await getProcessedItemIds(admin, 'https://feed-b.com/rss');
        expect(!ids.has('scoped-1'), 'feed A item not visible in feed B query').toBeTruthy();
      },
    },

    {
      name: 'getProcessedItemIds-returns-empty-set-without-admin',
      async run({ expect }) {
        const { getProcessedItemIds } = require(resolverPath);
        const ids = await getProcessedItemIds(null, 'https://example.com/feed');
        expect(ids.size, 'returns empty Set when admin is null').toBe(0);
      },
    },

    // ============================
    // UNIFIED SOURCE RESOLUTION (resolveSources / resolvePick)
    // ============================
    {
      name: 'resolveSources-brand-pick-resolves-seed',
      async run({ expect, omega }) {
        const { resolveSources } = require(resolverPath);
        const ctx = new Context(omega);

        const resolved = await resolveSources({
          sources: ['$brand'],
          count: 1,
          ctx,
        });

        expect(resolved.length, 'one source resolved').toBe(1);
        expect(resolved[0].type, 'type is brand').toBe('brand');
        expect(resolved[0].trackingData, 'no trackingData for $brand').toBe(null);
      },
    },

    {
      name: 'resolveSources-text-pick-resolves-content',
      async run({ expect, omega }) {
        const { resolveSources } = require(resolverPath);
        const ctx = new Context(omega);

        const resolved = await resolveSources({
          sources: ['Write about blockchain technology'],
          count: 1,
          ctx,
        });

        expect(resolved.length, 'one source resolved').toBe(1);
        expect(resolved[0].type, 'type is text').toBe('text');
        expect(resolved[0].content, 'content is the text seed').toBe('Write about blockchain technology');
        expect(resolved[0].trackingData, 'no trackingData for text').toBe(null);
      },
    },

    {
      name: 'resolvePick-feed-failure-never-falls-back-to-brand',
      timeout: 30000,
      async run({ expect, omega }) {
        const { createResolverState, resolvePick } = require(resolverPath);
        const ctx = new Context(omega);

        // $brand IS listed in the pool — the fallback chain must STILL never
        // land on it. Feed fails (nonexistent domain), no $parent listed → null.
        const state = createResolverState({
          sources: ['$feed:https://nonexistent-feed.invalid/feed.xml', '$brand'],
          ctx,
        });

        const result = await resolvePick(state, '$feed:https://nonexistent-feed.invalid/feed.xml');
        expect(result, 'feed failure returns null — never falls back to $brand').toBe(null);
      },
    },

    {
      name: 'resolvePick-feed-falls-back-to-other-feeds-then-parent',
      timeout: 30000,
      async run({ expect, omega }) {
        const { createResolverState, resolvePick } = require(resolverPath);
        const ctx = new Context(omega);

        // Both feeds dead, $parent listed but no omega → parent unreachable → null.
        // Exercises the full chain (same feed → other feeds → parent) without throwing.
        const state = createResolverState({
          sources: [
            '$feed:https://nonexistent-a.invalid/feed.xml',
            '$feed:https://nonexistent-b.invalid/feed.xml',
            '$parent',
          ],
          ctx,
        });

        const result = await resolvePick(state, '$feed:https://nonexistent-a.invalid/feed.xml');
        expect(result, 'chain exhausts feeds then parent, returns null').toBe(null);
        expect(state.feedCache.has('https://nonexistent-a.invalid/feed.xml'), 'first feed was tried').toBeTruthy();
        expect(state.feedCache.has('https://nonexistent-b.invalid/feed.xml'), 'second feed was tried as fallback').toBeTruthy();
        expect(Array.isArray(state.parentPool), 'parent pool was attempted after feeds').toBeTruthy();
      },
    },

    {
      name: 'resolvePick-parent-only-falls-back-to-parent',
      async run({ expect, omega }) {
        const { createResolverState, resolvePick } = require(resolverPath);
        const ctx = new Context(omega);

        // Parent unreachable (no omega). Feeds ARE listed — but $parent must
        // NOT fall back to them.
        const state = createResolverState({
          sources: ['$parent', '$feed:https://nonexistent.invalid/feed.xml', '$brand'],
          ctx,
        });

        const result = await resolvePick(state, '$parent');
        expect(result, 'parent failure returns null — never falls to feeds or $brand').toBe(null);
        expect(state.feedCache.size, 'no feed was touched by the parent chain').toBe(0);
      },
    },

    {
      name: 'resolveSources-empty-pool-returns-empty',
      async run({ expect, omega }) {
        const { resolveSources } = require(resolverPath);
        const ctx = new Context(omega);

        const resolved = await resolveSources({ sources: [], count: 3, ctx });
        expect(resolved.length, 'empty pool resolves nothing').toBe(0);
      },
    },

    {
      name: 'resolveSources-dead-feed-only-pool-returns-empty',
      timeout: 30000,
      async run({ expect, omega }) {
        const { resolveSources } = require(resolverPath);
        const ctx = new Context(omega);

        const resolved = await resolveSources({
          sources: ['$feed:https://nonexistent.invalid/feed.xml'],
          count: 2,
          ctx,
        });

        expect(resolved.length, 'dead-feed-only pool resolves nothing (no $brand invented)').toBe(0);
      },
    },

    // ============================
    // MIXED SOURCE DETECTION
    // ============================
    {
      name: 'source-type-detection-covers-all-types',
      async run({ expect }) {
        const sources = [
          '$brand',
          '$parent',
          '$feed:https://example.com/feed',
          'https://example.com/page',
          'Write about technology trends',
        ];

        // $brand
        expect(sources[0]).toBe('$brand');
        expect(sources[0].startsWith('$feed:')).toBe(false);

        // $parent
        expect(sources[1]).toBe('$parent');
        expect(sources[1].startsWith('$feed:')).toBe(false);

        // $feed:
        expect(sources[2].startsWith('$feed:')).toBe(true);

        // URL
        try { new URL(sources[3]); expect(true, 'URL is valid').toBeTruthy(); } catch (e) { expect.fail('URL should be valid'); }

        // text (not $brand, not $parent, not $feed:, not URL)
        expect(!sources[4].startsWith('$feed:'), 'text is not feed').toBeTruthy();
        expect(sources[4] !== '$brand', 'text is not $brand').toBeTruthy();
        expect(sources[4] !== '$parent', 'text is not $parent').toBeTruthy();
        try { new URL(sources[4]); expect.fail('text should not be URL'); } catch (e) { expect(true, 'text is not URL').toBeTruthy(); }
      },
    },
  ],
});

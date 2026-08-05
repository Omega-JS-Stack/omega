/**
 * limit-collections.js — dev-mode collection sampling (#190):
 *  1. the config read: unknown collection names, bad limits and a non-boolean
 *     randomize are ERRORS, and randomize is opt-in
 *  2. the sample itself: deterministic first-N, a random draw that still
 *     returns N of the same documents, and a collection that already fits
 *  3. the on-disk read: documents come back in the order the collection
 *     lists them (posts newest-first)
 *  4. through the real engine: a development build of the mini fixture ships
 *     the sampled posts only, and a production build of the SAME fixture
 *     ships every one of them
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');

const { buildWith, miniData, MINI } = require('./lib/build.js');
const { applyCollectionLimits, readLimits, sampleDocuments, collectionDocuments } = require('../src/limit-collections.js');

// The mini fixture's posts, newest first (dated filenames under _posts/).
const MINI_POSTS = 17;
const NEWEST_THREE = ['second-post', 'first-post', 'mini-story-17'];

// A post URL, not the blog index, its pagination, the taxonomy pages or the
// search index — all of which live under /blog too.
const postUrls = (pages) => [...pages.keys()]
  .filter((url) => url && /^\/blog\/[^/]+$/.test(url) && url !== '/blog/index.json' && url !== '/blog/categories' && url !== '/blog/tags')
  .sort();

test('an unset key limits nothing', () => {
  assert.strictEqual(readLimits(undefined), null);
  assert.strictEqual(readLimits(null), null);
});

test('randomize is opt-in and never reads as a collection', () => {
  assert.deepStrictEqual(readLimits({ posts: 50 }), { entries: [{ name: 'posts', limit: 50 }], randomize: false });
  assert.deepStrictEqual(readLimits({ posts: 50, randomize: true }), { entries: [{ name: 'posts', limit: 50 }], randomize: true });
  assert.deepStrictEqual(readLimits({ randomize: true }), { entries: [], randomize: true });
});

test('an unknown collection name is a hard error naming the real collections', () => {
  // The typo lane: `recipes` limits nothing, and a silent full collection is
  // indistinguishable from a working config until someone counts the pages.
  assert.throws(
    () => readLimits({ recipes: 50 }),
    /targets\.web\.dev\.limitCollections\.recipes is not an OMEGA collection — the collections are posts, alternatives, team, updates/,
  );
});

test('a limit must be a positive integer, and randomize a boolean', () => {
  assert.throws(() => readLimits({ posts: 0 }), /must be a positive integer \(max documents\) — got 0/);
  assert.throws(() => readLimits({ posts: -5 }), /must be a positive integer/);
  assert.throws(() => readLimits({ posts: 12.5 }), /must be a positive integer/);
  assert.throws(() => readLimits({ posts: '50' }), /must be a positive integer \(max documents\) — got "50"/);
  assert.throws(() => readLimits({ posts: 5, randomize: 'yes' }), /randomize must be a boolean — got string/);
  assert.throws(() => readLimits([{ posts: 5 }]), /must be a map of collection name → max documents — got array/);
});

test('the sample is the deterministic first N when randomize is off', () => {
  const documents = ['a', 'b', 'c', 'd', 'e'];

  assert.deepStrictEqual(sampleDocuments(documents, 3, false), ['a', 'b', 'c']);
  assert.deepStrictEqual(sampleDocuments(documents, 3, false), ['a', 'b', 'c'], 'same sample every build');
  assert.deepStrictEqual(documents, ['a', 'b', 'c', 'd', 'e'], 'the collection is never reordered');
});

test('a collection that already fits is returned whole', () => {
  const documents = ['a', 'b', 'c'];

  assert.strictEqual(sampleDocuments(documents, 3, false), documents);
  assert.strictEqual(sampleDocuments(documents, 10, true), documents);
});

test('a random sample is still N distinct documents drawn from the collection', () => {
  const documents = Array.from({ length: 100 }, (_, i) => `post-${i}`);
  const draws = Array.from({ length: 50 }, () => sampleDocuments(documents, 5, true));

  for (const draw of draws) {
    assert.strictEqual(draw.length, 5, 'exactly the limit');
    assert.strictEqual(new Set(draw).size, 5, 'no document drawn twice');
    assert.ok(draw.every((doc) => documents.includes(doc)), 'every document comes from the collection');
  }

  // No seed: the draw spreads across the collection instead of one slice of
  // it. 50 identical draws of 5 from 100 is not a thing that happens.
  assert.ok(draws.some((draw) => draw.join() !== draws[0].join()), 'the sample varies between builds');
  assert.strictEqual(documents.length, 100, 'the collection is never reordered');
});

test('a collection reads off disk in the order it lists its documents', () => {
  const posts = collectionDocuments(MINI, 'posts');

  assert.strictEqual(posts.length, MINI_POSTS);
  assert.deepStrictEqual(
    posts.slice(0, 3).map((file) => path.basename(file)),
    ['2024-02-20-second-post.md', '2024-01-15-first-post.md', '2023-12-15-mini-story-17.md'],
    'posts are newest-first, so first-N keeps what the blog shows first',
  );
  assert.deepStrictEqual(collectionDocuments(MINI, 'team'), [], 'a collection the brand has no content for is empty, not an error');
});

test('a production build validates the key it will never act on', () => {
  // The typo has to fail on `omega build` too — production reads the key
  // only to check it, so a bad name cannot hide until someone runs dev.
  const config = { addPreprocessor: () => assert.fail('production must never skip a document') };

  assert.throws(
    () => applyCollectionLimits(config, { consumerDir: MINI, limits: { recipes: 5 }, environment: 'production' }),
    /not an OMEGA collection/,
  );
  assert.strictEqual(
    applyCollectionLimits(config, { consumerDir: MINI, limits: { posts: 3 }, environment: 'production' }),
    null,
    'a valid limit samples nothing in production',
  );
});

test('a development build ships the sample; production ships the whole collection', async () => {
  const limited = { ...miniData, dev: { limitCollections: { posts: 3 } } };

  const dev = await buildWith(limited, { environment: 'development' }, 'limit-collections-dev');
  assert.deepStrictEqual(
    postUrls(dev),
    NEWEST_THREE.map((slug) => `/blog/${slug}`).sort(),
    'the sampled-out posts never enter the dev build',
  );
  assert.ok(!dev.has('/blog/page/2'), 'the blog index paginates over the sample too');

  const prod = await buildWith(limited, { environment: 'production' }, 'limit-collections-prod');
  assert.strictEqual(postUrls(prod).length, MINI_POSTS, 'a production build never samples, key set or not');
});

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
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildWith, miniData, MINI } = require('./lib/build.js');
const { applyCollectionLimits, readLimits, sampleDocuments, collectionDocuments } = require('../src/limit-collections.js');
const { setEnvironment } = require('@omega.js/config/environment');

// The mini fixture's posts, newest first (dated filenames under _posts/).
const MINI_POSTS = 17;
const NEWEST_THREE = ['second-post', 'first-post', 'mini-story-17'];

// A post URL, not the blog index, its pagination, the taxonomy pages or the
// search index — all of which live under /blog too.
const postUrls = (pages) => [...pages.keys()]
  .filter((url) => url && /^\/blog\/[^/]+$/.test(url) && url !== '/blog/index.json' && url !== '/blog/categories' && url !== '/blog/tags')
  .sort();

module.exports = defineCases({
  type: 'group',
  description: 'limit-collections',
  tests: [
    {
      name: 'an unset key limits nothing',
      run: (ctx) => {
        ctx.expect(readLimits(undefined)).toBe(null);
        ctx.expect(readLimits(null)).toBe(null);
      },
    },

    {
      name: 'randomize is opt-in and never reads as a collection',
      run: (ctx) => {
        ctx.expect(readLimits({ posts: 50 })).toEqual({ entries: [{ name: 'posts', limit: 50 }], randomize: false });
        ctx.expect(readLimits({ posts: 50, randomize: true })).toEqual({ entries: [{ name: 'posts', limit: 50 }], randomize: true });
        ctx.expect(readLimits({ randomize: true })).toEqual({ entries: [], randomize: true });
      },
    },

    {
      name: 'an unknown collection name is a hard error naming the real collections',
      run: (ctx) => {
        // The typo lane: `recipes` limits nothing, and a silent full collection is
        // indistinguishable from a working config until someone counts the pages.
        ctx.expect(() => readLimits({ recipes: 50 })).toThrow(/targets\.web\.dev\.limitCollections\.recipes is not an OMEGA collection — the collections are posts, alternatives, team, updates/);
      },
    },

    {
      name: 'a limit must be a positive integer, and randomize a boolean',
      run: (ctx) => {
        ctx.expect(() => readLimits({ posts: 0 })).toThrow(/must be a positive integer \(max documents\) — got 0/);
        ctx.expect(() => readLimits({ posts: -5 })).toThrow(/must be a positive integer/);
        ctx.expect(() => readLimits({ posts: 12.5 })).toThrow(/must be a positive integer/);
        ctx.expect(() => readLimits({ posts: '50' })).toThrow(/must be a positive integer \(max documents\) — got "50"/);
        ctx.expect(() => readLimits({ posts: 5, randomize: 'yes' })).toThrow(/randomize must be a boolean — got string/);
        ctx.expect(() => readLimits([{ posts: 5 }])).toThrow(/must be a map of collection name → max documents — got array/);
      },
    },

    {
      name: 'the sample is the deterministic first N when randomize is off',
      run: (ctx) => {
        const documents = ['a', 'b', 'c', 'd', 'e'];

        ctx.expect(sampleDocuments(documents, 3, false)).toEqual(['a', 'b', 'c']);
        ctx.expect(sampleDocuments(documents, 3, false), 'same sample every build').toEqual(['a', 'b', 'c']);
        ctx.expect(documents, 'the collection is never reordered').toEqual(['a', 'b', 'c', 'd', 'e']);
      },
    },

    {
      name: 'a collection that already fits is returned whole',
      run: (ctx) => {
        const documents = ['a', 'b', 'c'];

        ctx.expect(sampleDocuments(documents, 3, false)).toBe(documents);
        ctx.expect(sampleDocuments(documents, 10, true)).toBe(documents);
      },
    },

    {
      name: 'a random sample is still N distinct documents drawn from the collection',
      run: (ctx) => {
        const documents = Array.from({ length: 100 }, (_, i) => `post-${i}`);
        const draws = Array.from({ length: 50 }, () => sampleDocuments(documents, 5, true));

        for (const draw of draws) {
          ctx.expect(draw.length, 'exactly the limit').toBe(5);
          ctx.expect(new Set(draw).size, 'no document drawn twice').toBe(5);
          ctx.expect(draw.every((doc) => documents.includes(doc)), 'every document comes from the collection').toBeTruthy();
        }

        // No seed: the draw spreads across the collection instead of one slice of
        // it. 50 identical draws of 5 from 100 is not a thing that happens.
        ctx.expect(draws.some((draw) => draw.join() !== draws[0].join()), 'the sample varies between builds').toBeTruthy();
        ctx.expect(documents.length, 'the collection is never reordered').toBe(100);
      },
    },

    {
      name: 'a collection reads off disk in the order it lists its documents',
      run: (ctx) => {
        const posts = collectionDocuments(MINI, 'posts');

        ctx.expect(posts.length).toBe(MINI_POSTS);
        ctx.expect(posts.slice(0, 3).map((file) => path.basename(file)), 'posts are newest-first, so first-N keeps what the blog shows first').toEqual(['2024-02-20-second-post.md', '2024-01-15-first-post.md', '2023-12-15-mini-story-17.md']);
        ctx.expect(collectionDocuments(MINI, 'team'), 'a collection the brand has no content for is empty, not an error').toEqual([]);
      },
    },

    {
      name: 'a production build validates the key it will never act on',
      run: (ctx) => {
        // The typo has to fail on `omega build` too — production reads the key
        // only to check it, so a bad name cannot hide until someone runs dev.
        const config = { addPreprocessor: () => ctx.expect.fail('production must never skip a document') };

        // The lane NAMES the environment (#817): `omega build` names production for
        // the whole process, and this gate reads that one input.
        const saved = process.env.OMEGA_ENVIRONMENT;
        setEnvironment('production');
        ctx.after(() => {
          if (saved === undefined) delete process.env.OMEGA_ENVIRONMENT;
          else process.env.OMEGA_ENVIRONMENT = saved;
        });

        ctx.expect(() => applyCollectionLimits(config, { consumerDir: MINI, limits: { recipes: 5 } })).toThrow(/not an OMEGA collection/);
        ctx.expect(applyCollectionLimits(config, { consumerDir: MINI, limits: { posts: 3 } }), 'a valid limit samples nothing in production').toBe(null);
      },
    },

    {
      name: 'a development build ships the sample; production ships the whole collection',
      run: async (ctx) => {
        const limited = { ...miniData, dev: { limitCollections: { posts: 3 } } };

        const dev = await buildWith(limited, { environment: 'development' }, 'limit-collections-dev');
        ctx.expect(postUrls(dev), 'the sampled-out posts never enter the dev build').toEqual(NEWEST_THREE.map((slug) => `/blog/${slug}`).sort());
        ctx.expect(!dev.has('/blog/page/2'), 'the blog index paginates over the sample too').toBeTruthy();

        const prod = await buildWith(limited, { environment: 'production' }, 'limit-collections-prod');
        ctx.expect(postUrls(prod).length, 'a production build never samples, key set or not').toBe(MINI_POSTS);
      },
    },
  ],
});

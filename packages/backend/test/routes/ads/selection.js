/**
 * Test: Ads selection scoring (pure logic)
 *
 * Eligibility filters (enabled, whitelist, blacklist, never-self), contextual
 * tag matching, adId pin, and the weighted-random distribution shape.
 * Pure functions — called directly per the no-mock doctrine's only exception.
 *
 * Run: npx omega test backend:routes/ads/selection
 */
const { isEligible, filterEligible, scoreAd, weightedPick, selectAd, normalizeHost, parseTags } = require('../../../src/manager/routes/ads/utils.js');

function makeAd(id, overrides) {
  return {
    id,
    enabled: true,
    title: `Ad ${id}`,
    link: `https://${id}-shop.example/products`,
    weight: 1,
    targeting: { sites: [], categories: [], keywords: [] },
    whitelist: [],
    blacklist: [],
    ...overrides,
  };
}

module.exports = {
  description: 'Ads selection scoring',
  type: 'group',
  tests: [
    {
      name: 'normalize-host-handles-urls-and-hosts',
      async run({ assert }) {
        assert.equal(normalizeHost('https://www.Example.com/path?q=1'), 'example.com', 'URL should normalize to bare host');
        assert.equal(normalizeHost('Example.com'), 'example.com', 'Bare host should lowercase');
        assert.equal(normalizeHost('example.com:8080'), 'example.com', 'Port should strip');
        assert.equal(normalizeHost(''), '', 'Empty should stay empty');
        assert.equal(normalizeHost(null), '', 'Null should stay empty');
      },
    },

    {
      name: 'parse-tags-normalizes-comma-list',
      async run({ assert }) {
        assert.deepEqual(parseTags(' Music, audio-tools ,,DEV '), ['music', 'audio-tools', 'dev'], 'Tags should trim, lowercase, drop empties');
        assert.deepEqual(parseTags(''), [], 'Empty string should give no tags');
      },
    },

    {
      name: 'disabled-ads-are-ineligible',
      async run({ assert }) {
        assert.equal(isEligible(makeAd('a', { enabled: false }), 'site.example'), false, 'Disabled ad should be ineligible');
        assert.equal(isEligible(makeAd('a'), 'site.example'), true, 'Enabled ad should be eligible');
      },
    },

    {
      name: 'whitelist-restricts-to-listed-hosts',
      async run({ assert }) {
        const ad = makeAd('a', { whitelist: ['allowed.example'] });

        assert.equal(isEligible(ad, 'allowed.example'), true, 'Whitelisted host should be eligible');
        assert.equal(isEligible(ad, 'other.example'), false, 'Non-whitelisted host should be ineligible');
        assert.equal(isEligible(ad, ''), false, 'Unknown parent should fail closed for whitelisted ads');
      },
    },

    {
      name: 'blacklist-excludes-listed-hosts',
      async run({ assert }) {
        const ad = makeAd('a', { blacklist: ['blocked.example'] });

        assert.equal(isEligible(ad, 'blocked.example'), false, 'Blacklisted host should be ineligible');
        assert.equal(isEligible(ad, 'other.example'), true, 'Other hosts should be eligible');
      },
    },

    {
      name: 'never-advertise-self',
      async run({ assert }) {
        const ad = makeAd('a', { link: 'https://www.myshop.example/promo' });

        assert.equal(isEligible(ad, 'myshop.example'), false, 'Ad should never serve on its own link host');
        assert.equal(isEligible(ad, 'other.example'), true, 'Ad should serve elsewhere');
      },
    },

    {
      name: 'filter-eligible-composes-all-rules',
      async run({ assert }) {
        const ads = [
          makeAd('open'),
          makeAd('disabled', { enabled: false }),
          makeAd('blacklisted', { blacklist: ['parent.example'] }),
          makeAd('self', { link: 'https://parent.example/promo' }),
          makeAd('whitelisted-elsewhere', { whitelist: ['other.example'] }),
        ];
        const eligible = filterEligible(ads, 'parent.example');

        assert.equal(eligible.length, 1, 'Only the open ad should survive');
        assert.equal(eligible[0].id, 'open', 'The open ad should be the survivor');
      },
    },

    {
      name: 'tag-matching-scores-overlap',
      async run({ assert }) {
        const ad = makeAd('a', { targeting: { sites: [], categories: ['Music'], keywords: ['audio-tools', 'dev'] } });

        assert.equal(scoreAd(ad, ['music', 'audio-tools']), 2, 'Score should count overlapping tags (case-insensitive)');
        assert.equal(scoreAd(ad, ['cooking']), 0, 'No overlap should score 0');
        assert.equal(scoreAd(ad, []), 0, 'No request tags should be neutral (0)');
        assert.equal(scoreAd(makeAd('b'), ['music']), 0, 'Untargeted ad should be neutral (0)');
      },
    },

    {
      name: 'select-prefers-top-scorers',
      async run({ assert }) {
        const ads = [
          makeAd('untargeted'),
          makeAd('targeted', { targeting: { sites: [], categories: ['music'], keywords: ['audio'] } }),
        ];

        // The targeted ad outscores the untargeted one — always selected
        for (let i = 0; i < 25; i++) {
          const selected = selectAd(ads, { parentHost: 'site.example', tags: ['music', 'audio'] });
          assert.equal(selected.id, 'targeted', 'Top scorer should always win');
        }
      },
    },

    {
      name: 'no-tags-anywhere-is-pure-weighted-shuffle',
      async run({ assert }) {
        const ads = [makeAd('a'), makeAd('b'), makeAd('c')];
        const seen = new Set();

        for (let i = 0; i < 200; i++) {
          seen.add(selectAd(ads, { parentHost: 'site.example', tags: [] }).id);
        }

        assert.equal(seen.size, 3, 'All ads should appear in the neutral shuffle');
      },
    },

    {
      name: 'adid-pin-serves-eligible-pin',
      async run({ assert }) {
        const ads = [makeAd('a', { weight: 100 }), makeAd('b', { weight: 1 })];
        const selected = selectAd(ads, { parentHost: 'site.example', adId: 'b' });

        assert.equal(selected.id, 'b', 'Pinned eligible ad should be served regardless of weight');
      },
    },

    {
      name: 'adid-pin-ineligible-falls-through',
      async run({ assert }) {
        const ads = [
          makeAd('open'),
          makeAd('self', { link: 'https://parent.example/promo' }),
        ];
        const selected = selectAd(ads, { parentHost: 'parent.example', adId: 'self' });

        assert.equal(selected.id, 'open', 'Ineligible pin should fall through to normal selection');
      },
    },

    {
      name: 'no-eligible-ads-returns-null',
      async run({ assert }) {
        const ads = [makeAd('disabled', { enabled: false })];

        assert.equal(selectAd(ads, { parentHost: 'site.example' }), null, 'No eligible ads should return null');
        assert.equal(selectAd([], {}), null, 'Empty inventory should return null');
      },
    },

    {
      name: 'weighted-pick-is-deterministic-per-roll',
      async run({ assert }) {
        const ads = [makeAd('a', { weight: 1 }), makeAd('b', { weight: 3 })];

        assert.equal(weightedPick(ads, () => 0.1).id, 'a', 'Roll in the first quarter should pick a');
        assert.equal(weightedPick(ads, () => 0.5).id, 'b', 'Roll past the first quarter should pick b');
        assert.equal(weightedPick(ads, () => 0.99).id, 'b', 'High roll should pick b');
      },
    },

    {
      name: 'weight-distribution-shape',
      timeout: 15000,
      async run({ assert }) {
        // weight 9 vs 1 → expected 90% share over 1000 draws (±5 sd bounds)
        const ads = [makeAd('heavy', { weight: 9 }), makeAd('light', { weight: 1 })];

        let heavy = 0;

        for (let i = 0; i < 1000; i++) {
          if (selectAd(ads, { parentHost: 'site.example' }).id === 'heavy') {
            heavy++;
          }
        }

        assert.inRange(heavy, 850, 950, `Heavy ad should win ~90% of draws (got ${heavy}/1000)`);
      },
    },

    {
      name: 'invalid-weight-defaults-to-1',
      async run({ assert }) {
        const ads = [makeAd('a', { weight: 'banana' }), makeAd('b', { weight: -5 })];
        const seen = new Set();

        for (let i = 0; i < 100; i++) {
          seen.add(selectAd(ads, {}).id);
        }

        assert.equal(seen.size, 2, 'Invalid weights should behave as 1 (both ads appear)');
      },
    },
  ],
};

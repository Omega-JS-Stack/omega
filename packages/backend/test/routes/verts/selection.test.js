/**
 * Test: Verts selection scoring (pure logic)
 *
 * Eligibility filters (enabled, whitelist, blacklist, never-self), contextual
 * tag matching, vertId pin, and the weighted-random distribution shape.
 * Pure functions — called directly per the no-mock doctrine's only exception.
 *
 * Run: npx omega test backend:routes/verts/selection
 */
const { isEligible, filterEligible, scoreVert, weightedPick, selectVert, normalizeHost, normalizeBrandId, parseTags } = require('../../../dist/omega/routes/verts/utils.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

function makeAd(id, overrides) {
  return {
    id,
    enabled: true,
    title: `Vert ${id}`,
    link: `https://${id}-shop.example/products`,
    weight: 1,
    targeting: { sites: [], categories: [], keywords: [] },
    whitelist: [],
    blacklist: [],
    ...overrides,
  };
}

module.exports = defineCases({
  description: 'Verts selection scoring',
  type: 'group',
  tests: [
    {
      name: 'normalize-host-handles-urls-and-hosts',
      async run({ expect }) {
        expect(normalizeHost('https://www.Example.com/path?q=1'), 'URL should normalize to bare host').toBe('example.com');
        expect(normalizeHost('Example.com'), 'Bare host should lowercase').toBe('example.com');
        expect(normalizeHost('example.com:8080'), 'Port should strip').toBe('example.com');
        expect(normalizeHost(''), 'Empty should stay empty').toBe('');
        expect(normalizeHost(null), 'Null should stay empty').toBe('');
      },
    },

    {
      name: 'normalize-brand-id-keeps-only-config-slugs',
      async run({ expect }) {
        expect(normalizeBrandId('Daily-Build'), 'A real slug should lowercase through').toBe('daily-build');
        expect(normalizeBrandId(' omega.js '), 'Surrounding whitespace should trim').toBe('omega.js');
        expect(normalizeBrandId('utm spam&x=1'), 'Free text should never reach an advertiser URL').toBe('');
        expect(normalizeBrandId('9lives'), 'A slug starts with a letter').toBe('');
        expect(normalizeBrandId(''), 'Empty should stay empty').toBe('');
        expect(normalizeBrandId(null), 'Null should stay empty').toBe('');
      },
    },

    {
      name: 'parse-tags-normalizes-comma-list',
      async run({ expect }) {
        expect(parseTags(' Music, audio-tools ,,DEV '), 'Tags should trim, lowercase, drop empties').toEqual(['music', 'audio-tools', 'dev']);
        expect(parseTags(''), 'Empty string should give no tags').toEqual([]);
      },
    },

    {
      name: 'disabled-verts-are-ineligible',
      async run({ expect }) {
        expect(isEligible(makeAd('a', { enabled: false }), 'site.example'), 'Disabled vert should be ineligible').toBe(false);
        expect(isEligible(makeAd('a'), 'site.example'), 'Enabled vert should be eligible').toBe(true);
      },
    },

    {
      name: 'whitelist-restricts-to-listed-hosts',
      async run({ expect }) {
        const vert = makeAd('a', { whitelist: ['allowed.example'] });

        expect(isEligible(vert, 'allowed.example'), 'Whitelisted host should be eligible').toBe(true);
        expect(isEligible(vert, 'other.example'), 'Non-whitelisted host should be ineligible').toBe(false);
        expect(isEligible(vert, ''), 'Unknown parent should fail closed for whitelisted verts').toBe(false);
      },
    },

    {
      name: 'blacklist-excludes-listed-hosts',
      async run({ expect }) {
        const vert = makeAd('a', { blacklist: ['blocked.example'] });

        expect(isEligible(vert, 'blocked.example'), 'Blacklisted host should be ineligible').toBe(false);
        expect(isEligible(vert, 'other.example'), 'Other hosts should be eligible').toBe(true);
      },
    },

    {
      name: 'never-advertise-self',
      async run({ expect }) {
        const vert = makeAd('a', { link: 'https://www.myshop.example/promo' });

        expect(isEligible(vert, 'myshop.example'), 'Vert should never serve on its own link host').toBe(false);
        expect(isEligible(vert, 'other.example'), 'Vert should serve elsewhere').toBe(true);
      },
    },

    {
      name: 'filter-eligible-composes-all-rules',
      async run({ expect }) {
        const verts = [
          makeAd('open'),
          makeAd('disabled', { enabled: false }),
          makeAd('blacklisted', { blacklist: ['parent.example'] }),
          makeAd('self', { link: 'https://parent.example/promo' }),
          makeAd('whitelisted-elsewhere', { whitelist: ['other.example'] }),
        ];
        const eligible = filterEligible(verts, 'parent.example');

        expect(eligible.length, 'Only the open vert should survive').toBe(1);
        expect(eligible[0].id, 'The open vert should be the survivor').toBe('open');
      },
    },

    {
      name: 'tag-matching-scores-overlap',
      async run({ expect }) {
        const vert = makeAd('a', { targeting: { sites: [], categories: ['Music'], keywords: ['audio-tools', 'dev'] } });

        expect(scoreVert(vert, ['music', 'audio-tools']), 'Score should count overlapping tags (case-insensitive)').toBe(2);
        expect(scoreVert(vert, ['cooking']), 'No overlap should score 0').toBe(0);
        expect(scoreVert(vert, []), 'No request tags should be neutral (0)').toBe(0);
        expect(scoreVert(makeAd('b'), ['music']), 'Untargeted vert should be neutral (0)').toBe(0);
      },
    },

    {
      name: 'select-prefers-top-scorers',
      async run({ expect }) {
        const verts = [
          makeAd('untargeted'),
          makeAd('targeted', { targeting: { sites: [], categories: ['music'], keywords: ['audio'] } }),
        ];

        // The targeted vert outscores the untargeted one — always selected
        for (let i = 0; i < 25; i++) {
          const selected = selectVert(verts, { parentHost: 'site.example', tags: ['music', 'audio'] });
          expect(selected.id, 'Top scorer should always win').toBe('targeted');
        }
      },
    },

    {
      name: 'no-tags-anywhere-is-pure-weighted-shuffle',
      async run({ expect }) {
        const verts = [makeAd('a'), makeAd('b'), makeAd('c')];
        const seen = new Set();

        for (let i = 0; i < 200; i++) {
          seen.add(selectVert(verts, { parentHost: 'site.example', tags: [] }).id);
        }

        expect(seen.size, 'All verts should appear in the neutral shuffle').toBe(3);
      },
    },

    {
      name: 'adid-pin-serves-eligible-pin',
      async run({ expect }) {
        const verts = [makeAd('a', { weight: 100 }), makeAd('b', { weight: 1 })];
        const selected = selectVert(verts, { parentHost: 'site.example', vertId: 'b' });

        expect(selected.id, 'Pinned eligible vert should be served regardless of weight').toBe('b');
      },
    },

    {
      name: 'adid-pin-ineligible-falls-through',
      async run({ expect }) {
        const verts = [
          makeAd('open'),
          makeAd('self', { link: 'https://parent.example/promo' }),
        ];
        const selected = selectVert(verts, { parentHost: 'parent.example', vertId: 'self' });

        expect(selected.id, 'Ineligible pin should fall through to normal selection').toBe('open');
      },
    },

    {
      name: 'no-eligible-verts-returns-null',
      async run({ expect }) {
        const verts = [makeAd('disabled', { enabled: false })];

        expect(selectVert(verts, { parentHost: 'site.example' }), 'No eligible verts should return null').toBe(null);
        expect(selectVert([], {}), 'Empty inventory should return null').toBe(null);
      },
    },

    {
      name: 'weighted-pick-is-deterministic-per-roll',
      async run({ expect }) {
        const verts = [makeAd('a', { weight: 1 }), makeAd('b', { weight: 3 })];

        expect(weightedPick(verts, () => 0.1).id, 'Roll in the first quarter should pick a').toBe('a');
        expect(weightedPick(verts, () => 0.5).id, 'Roll past the first quarter should pick b').toBe('b');
        expect(weightedPick(verts, () => 0.99).id, 'High roll should pick b').toBe('b');
      },
    },

    {
      name: 'weight-distribution-shape',
      timeout: 15000,
      async run({ expect }) {
        // weight 9 vs 1 → expected 90% share over 1000 draws (±5 sd bounds)
        const verts = [makeAd('heavy', { weight: 9 }), makeAd('light', { weight: 1 })];

        let heavy = 0;

        for (let i = 0; i < 1000; i++) {
          if (selectVert(verts, { parentHost: 'site.example' }).id === 'heavy') {
            heavy++;
          }
        }

        expect(heavy, `Heavy vert should win ~90% of draws (got ${heavy}/1000)`).toBeGreaterThanOrEqual(850);
        expect(heavy, `Heavy vert should win ~90% of draws (got ${heavy}/1000)`).toBeLessThanOrEqual(950);
      },
    },

    {
      name: 'invalid-weight-defaults-to-1',
      async run({ expect }) {
        const verts = [makeAd('a', { weight: 'banana' }), makeAd('b', { weight: -5 })];
        const seen = new Set();

        for (let i = 0; i < 100; i++) {
          seen.add(selectVert(verts, {}).id);
        }

        expect(seen.size, 'Invalid weights should behave as 1 (both verts appear)').toBe(2);
      },
    },
  ],
});

/**
 * Unit tests for the features contract
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)) — the shared
 * derivation the backend's gate and the browser's account page BOTH read, so
 * the number that refuses a request and the number a usage bar draws can never
 * be two different numbers.
 *
 * The promises:
 *  - a `usage` block is what meters a feature; everything else is a perk;
 *  - pacing by day is the DEFAULT, `pace: false` opts out, and the day's share
 *    is the month limit spread over the days of THIS month;
 *  - a per-user override wins over the plan's number, and the day share
 *    derives from the effective number, not the plan's;
 *  - -1 is unlimited all the way through: limit, day share, and what is left.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const {
  isCountedFeature,
  isPacedFeature,
  featureMirrors,
  dayShare,
  daysInMonth,
  resolveFeature,
  resolveFeatures,
} = require('../src/index.js');

const CATALOG = {
  saves: { name: 'Saves', icon: 'feather', definition: 'Notes you can save.', usage: { mirror: ['teams'] } },
  exports: { name: 'Exports', icon: 'file-export', usage: { pace: false } },
  support: { name: 'Priority support', icon: 'headset' },
};

const PRODUCT = { id: 'premium', features: { saves: 100, exports: 20, support: true } };

// A 31-day month, so ceil(100 / 31) = 4 is a number the test can name.
const IN_MARCH = new Date('2026-03-10T12:00:00.000Z');

module.exports = defineCases({
  type: 'group',
  description: 'features',
  tests: [
    {
      name: 'a `usage` block is what makes a feature counted; everything else is a perk',
      run: (ctx) => {
        ctx.expect(isCountedFeature(CATALOG.saves)).toBe(true);
        ctx.expect(isCountedFeature(CATALOG.exports)).toBe(true);
        ctx.expect(isCountedFeature(CATALOG.support)).toBe(false);
        ctx.expect(isCountedFeature(undefined)).toBe(false);
      },
    },

    {
      name: 'pacing by day is the default; pace: false opts out',
      run: (ctx) => {
        ctx.expect(isPacedFeature(CATALOG.saves), 'no pace named → paced').toBe(true);
        ctx.expect(isPacedFeature(CATALOG.exports), 'pace: false → a plain monthly counter').toBe(false);
        ctx.expect(isPacedFeature(CATALOG.support), 'a perk is never paced').toBe(false);
      },
    },

    {
      name: 'mirrors come from the catalog, never the call site',
      run: (ctx) => {
        ctx.expect(featureMirrors(CATALOG.saves)).toEqual(['teams']);
        ctx.expect(featureMirrors(CATALOG.exports)).toEqual([]);
        ctx.expect(featureMirrors(CATALOG.support)).toEqual([]);
      },
    },

    {
      name: 'the day share is the month limit spread over the days of THIS month',
      run: (ctx) => {
        ctx.expect(daysInMonth(IN_MARCH)).toBe(31);
        ctx.expect(dayShare(100, IN_MARCH), 'ceil(100/31)').toBe(4);
        ctx.expect(dayShare(10, IN_MARCH), 'a small quota still allows one a day').toBe(1);
        ctx.expect(dayShare(100, new Date('2026-02-10T12:00:00.000Z')), 'ceil(100/28)').toBe(4);
        ctx.expect(dayShare(-1, IN_MARCH), 'unlimited stays unlimited').toBe(-1);
        ctx.expect(dayShare(0, IN_MARCH), 'nothing stays nothing').toBe(0);
      },
    },

    {
      name: 'a counted feature resolves the plan number, the day share, and both counters',
      run: (ctx) => {
        const account = { usage: { saves: { monthly: 30, daily: 2, total: 900 } } };
        const saves = resolveFeature('saves', { catalog: CATALOG, product: PRODUCT, account, now: IN_MARCH });

        ctx.expect(saves.name).toBe('Saves');
        ctx.expect(saves.icon).toBe('feather');
        ctx.expect(saves.counted).toBe(true);
        ctx.expect(saves.limit).toBe(100);
        ctx.expect(saves.used).toBe(30);
        ctx.expect(saves.left).toBe(70);
        ctx.expect(saves.total).toBe(900);
        ctx.expect(saves.day).toEqual({ limit: 4, used: 2, left: 2 });
      },
    },

    {
      name: 'an unpaced counted feature has no day cap at all',
      run: (ctx) => {
        const exports_ = resolveFeature('exports', {
          catalog: CATALOG,
          product: PRODUCT,
          account: { usage: { exports: { monthly: 5, daily: 5 } } },
          now: IN_MARCH,
        });

        ctx.expect(exports_.limit).toBe(20);
        ctx.expect(exports_.day.limit, 'pace: false → the day never refuses').toBe(-1);
        ctx.expect(exports_.day.left).toBe(-1);
      },
    },

    {
      name: 'a per-user override wins over the plan, and the day share follows it',
      run: (ctx) => {
        const account = {
          usage: {
            saves: { monthly: 120, daily: 0 },
            overrides: { saves: 300 },
          },
        };
        const saves = resolveFeature('saves', { catalog: CATALOG, product: PRODUCT, account, now: IN_MARCH });

        ctx.expect(saves.planLimit, 'the plan still says what the plan says').toBe(100);
        ctx.expect(saves.override).toBe(300);
        ctx.expect(saves.limit, 'the override is the number that counts').toBe(300);
        ctx.expect(saves.left).toBe(180);
        ctx.expect(saves.day.limit, 'ceil(300/31) — derived from the EFFECTIVE number').toBe(10);
      },
    },

    {
      name: 'unlimited is -1 all the way through',
      run: (ctx) => {
        const unlimited = resolveFeature('saves', {
          catalog: CATALOG,
          product: { id: 'pro', features: { saves: -1 } },
          account: { usage: { saves: { monthly: 5000, daily: 400 } } },
          now: IN_MARCH,
        });

        ctx.expect(unlimited.limit).toBe(-1);
        ctx.expect(unlimited.left).toBe(-1);
        ctx.expect(unlimited.day).toEqual({ limit: -1, used: 400, left: -1 });
      },
    },

    {
      name: 'a perk carries the product value and no counters',
      run: (ctx) => {
        const support = resolveFeature('support', { catalog: CATALOG, product: PRODUCT, account: {} });

        ctx.expect(support.counted).toBe(false);
        ctx.expect(support.value).toBe(true);
        ctx.expect(support.limit).toBe(0);
        ctx.expect(support.day.limit).toBe(-1);
      },
    },

    {
      name: 'a feature the plan never names is a limit of zero — nothing left',
      run: (ctx) => {
        const saves = resolveFeature('saves', { catalog: CATALOG, product: { id: 'basic', features: {} }, account: {} });

        ctx.expect(saves.limit).toBe(0);
        ctx.expect(saves.left).toBe(0);
        ctx.expect(saves.day.left).toBe(0);
      },
    },

    {
      name: 'resolveFeatures walks the catalog in ITS order — the row order every surface renders',
      run: (ctx) => {
        const rows = resolveFeatures({ catalog: CATALOG, product: PRODUCT, account: {}, now: IN_MARCH });

        ctx.expect(rows.map((row) => row.id)).toEqual(['saves', 'exports', 'support']);
      },
    },
  ],
});

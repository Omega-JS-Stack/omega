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
const { test } = require('node:test');
const assert = require('node:assert/strict');

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

test('a `usage` block is what makes a feature counted; everything else is a perk', () => {
  assert.strictEqual(isCountedFeature(CATALOG.saves), true);
  assert.strictEqual(isCountedFeature(CATALOG.exports), true);
  assert.strictEqual(isCountedFeature(CATALOG.support), false);
  assert.strictEqual(isCountedFeature(undefined), false);
});

test('pacing by day is the default; pace: false opts out', () => {
  assert.strictEqual(isPacedFeature(CATALOG.saves), true, 'no pace named → paced');
  assert.strictEqual(isPacedFeature(CATALOG.exports), false, 'pace: false → a plain monthly counter');
  assert.strictEqual(isPacedFeature(CATALOG.support), false, 'a perk is never paced');
});

test('mirrors come from the catalog, never the call site', () => {
  assert.deepStrictEqual(featureMirrors(CATALOG.saves), ['teams']);
  assert.deepStrictEqual(featureMirrors(CATALOG.exports), []);
  assert.deepStrictEqual(featureMirrors(CATALOG.support), []);
});

test('the day share is the month limit spread over the days of THIS month', () => {
  assert.strictEqual(daysInMonth(IN_MARCH), 31);
  assert.strictEqual(dayShare(100, IN_MARCH), 4, 'ceil(100/31)');
  assert.strictEqual(dayShare(10, IN_MARCH), 1, 'a small quota still allows one a day');
  assert.strictEqual(dayShare(100, new Date('2026-02-10T12:00:00.000Z')), 4, 'ceil(100/28)');
  assert.strictEqual(dayShare(-1, IN_MARCH), -1, 'unlimited stays unlimited');
  assert.strictEqual(dayShare(0, IN_MARCH), 0, 'nothing stays nothing');
});

test('a counted feature resolves the plan number, the day share, and both counters', () => {
  const account = { usage: { saves: { monthly: 30, daily: 2, total: 900 } } };
  const saves = resolveFeature('saves', { catalog: CATALOG, product: PRODUCT, account, now: IN_MARCH });

  assert.strictEqual(saves.name, 'Saves');
  assert.strictEqual(saves.icon, 'feather');
  assert.strictEqual(saves.counted, true);
  assert.strictEqual(saves.limit, 100);
  assert.strictEqual(saves.used, 30);
  assert.strictEqual(saves.left, 70);
  assert.strictEqual(saves.total, 900);
  assert.deepStrictEqual(saves.day, { limit: 4, used: 2, left: 2 });
});

test('an unpaced counted feature has no day cap at all', () => {
  const exports_ = resolveFeature('exports', {
    catalog: CATALOG,
    product: PRODUCT,
    account: { usage: { exports: { monthly: 5, daily: 5 } } },
    now: IN_MARCH,
  });

  assert.strictEqual(exports_.limit, 20);
  assert.strictEqual(exports_.day.limit, -1, 'pace: false → the day never refuses');
  assert.strictEqual(exports_.day.left, -1);
});

test('a per-user override wins over the plan, and the day share follows it', () => {
  const account = {
    usage: {
      saves: { monthly: 120, daily: 0 },
      overrides: { saves: 300 },
    },
  };
  const saves = resolveFeature('saves', { catalog: CATALOG, product: PRODUCT, account, now: IN_MARCH });

  assert.strictEqual(saves.planLimit, 100, 'the plan still says what the plan says');
  assert.strictEqual(saves.override, 300);
  assert.strictEqual(saves.limit, 300, 'the override is the number that counts');
  assert.strictEqual(saves.left, 180);
  assert.strictEqual(saves.day.limit, 10, 'ceil(300/31) — derived from the EFFECTIVE number');
});

test('unlimited is -1 all the way through', () => {
  const unlimited = resolveFeature('saves', {
    catalog: CATALOG,
    product: { id: 'pro', features: { saves: -1 } },
    account: { usage: { saves: { monthly: 5000, daily: 400 } } },
    now: IN_MARCH,
  });

  assert.strictEqual(unlimited.limit, -1);
  assert.strictEqual(unlimited.left, -1);
  assert.deepStrictEqual(unlimited.day, { limit: -1, used: 400, left: -1 });
});

test('a perk carries the product value and no counters', () => {
  const support = resolveFeature('support', { catalog: CATALOG, product: PRODUCT, account: {} });

  assert.strictEqual(support.counted, false);
  assert.strictEqual(support.value, true);
  assert.strictEqual(support.limit, 0);
  assert.strictEqual(support.day.limit, -1);
});

test('a feature the plan never names is a limit of zero — nothing left', () => {
  const saves = resolveFeature('saves', { catalog: CATALOG, product: { id: 'basic', features: {} }, account: {} });

  assert.strictEqual(saves.limit, 0);
  assert.strictEqual(saves.left, 0);
  assert.strictEqual(saves.day.left, 0);
});

test('resolveFeatures walks the catalog in ITS order — the row order every surface renders', () => {
  const rows = resolveFeatures({ catalog: CATALOG, product: PRODUCT, account: {}, now: IN_MARCH });

  assert.deepStrictEqual(rows.map((row) => row.id), ['saves', 'exports', 'support']);
});

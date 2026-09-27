/**
 * Unit tests for the top-level `features` catalog and the per-product values
 * map. The promises, each one a thing a brand can be misled by: a feature is
 * DEFINED once in the catalog and a product names only its VALUE; a counted
 * feature (a `usage` block) takes a number and a perk takes true/false/a
 * string, never the other; a value on an id the catalog does not define fails
 * instead of vanishing; the product `features` ARRAY fails loudly. (`limits`
 * and `rateLimit` are `omega migrate` rows.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateConfig } = require('../src/index.js');
const { SHARED_SCHEMA, SHARED_SECTIONS } = require('../src/schema.js');

const BRAND = { brand: { id: 'sandbox-brand', name: 'Sandbox Brand' } };

// One counted feature (paced by day, the default), one counted feature that
// opted out of pacing, one perk.
const CATALOG = {
  saves: {
    name: 'Saves',
    icon: 'feather',
    definition: 'Notes, clips, and pages you can save per month.',
    usage: { mirror: ['teams'] },
  },
  exports: {
    name: 'Exports',
    icon: 'file-export',
    usage: { pace: false },
  },
  support: {
    name: 'Priority support',
    icon: 'headset',
    definition: 'Your tickets jump the queue.',
  },
};

function validate(extra) {
  return validateConfig({ ...BRAND, features: CATALOG, ...extra });
}

test('the catalog is a declared shared section with a schema rule', () => {
  const paths = SHARED_SCHEMA.map((rule) => rule.path);

  assert.ok(paths.includes('features'), 'the top-level features catalog is declared');
  assert.ok(SHARED_SECTIONS.includes('features'), 'features is a shared section — disperse enumerates it');
});

test('a catalog + a product values map validates clean', () => {
  const { errors } = validate({
    payment: { products: [{ id: 'basic', name: 'Basic', features: { saves: 100, exports: -1, support: true } }] },
  });

  assert.deepStrictEqual(errors, []);
});

test('a number on a perk fails — a perk is never metered', () => {
  const { errors } = validate({
    payment: { products: [{ id: 'basic', name: 'Basic', features: { support: 5 } }] },
  });

  assert.ok(
    errors.some((e) => e.includes('support') && e.includes('is not a counted feature')),
    `expected a perk-number error, got ${JSON.stringify(errors)}`,
  );
});

test('a perk value on a counted feature fails — a counted feature is a number', () => {
  const trueValue = validate({
    payment: { products: [{ id: 'basic', name: 'Basic', features: { saves: true } }] },
  });
  const stringValue = validate({
    payment: { products: [{ id: 'basic', name: 'Basic', features: { saves: 'lots' } }] },
  });

  assert.ok(
    trueValue.errors.some((e) => e.includes('saves') && e.includes('is a counted feature')),
    `expected a counted-feature error for true, got ${JSON.stringify(trueValue.errors)}`,
  );
  assert.ok(
    stringValue.errors.some((e) => e.includes('saves') && e.includes('is a counted feature')),
    `expected a counted-feature error for a string, got ${JSON.stringify(stringValue.errors)}`,
  );
});

test('a value on an id the catalog does not define fails', () => {
  const { errors } = validate({
    payment: { products: [{ id: 'basic', name: 'Basic', features: { seats: 10 } }] },
  });

  assert.ok(
    errors.some((e) => e.includes('seats') && e.includes('the top-level features catalog')),
    `expected an unknown-id error, got ${JSON.stringify(errors)}`,
  );
});

test('false on a counted feature is legal — the tier simply does not include it', () => {
  const { errors } = validate({
    payment: { products: [{ id: 'basic', name: 'Basic', features: { saves: false, support: false } }] },
  });

  assert.deepStrictEqual(errors, []);
});

test('a catalog entry pacing on anything but a day (or false) fails', () => {
  const { errors } = validateConfig({
    ...BRAND,
    features: { saves: { name: 'Saves', usage: { pace: 'weekly' } } },
  });

  assert.ok(
    errors.some((e) => e.includes('features.saves.usage.pace')),
    `expected a pace error, got ${JSON.stringify(errors)}`,
  );
});

test('a catalog entry mirroring anything but a list of doc kinds fails', () => {
  const { errors } = validateConfig({
    ...BRAND,
    features: { saves: { name: 'Saves', usage: { mirror: 'teams' } } },
  });

  assert.ok(
    errors.some((e) => e.includes('features.saves.usage.mirror')),
    `expected a mirror error, got ${JSON.stringify(errors)}`,
  );
});

test('a catalog entry with no name fails — the name is what every surface prints', () => {
  const { errors } = validateConfig({ ...BRAND, features: { saves: { icon: 'feather' } } });

  assert.ok(
    errors.some((e) => e.includes('features.saves.name')),
    `expected a name error, got ${JSON.stringify(errors)}`,
  );
});

// ─── the retired shapes (#647) ───

test('the product `features` ARRAY is retired — it is a map of values now', () => {
  const { errors } = validate({
    payment: { products: [{ id: 'basic', name: 'Basic', features: [{ id: 'saves', name: 'Saves', value: 100 }] }] },
  });

  assert.ok(
    errors.some((e) => e.includes('config.payment.products[0]') && e.includes('must be a map of values')),
    `expected an array-shape error, got ${JSON.stringify(errors)}`,
  );
});

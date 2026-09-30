/**
 * Brand-root `omega migrate --execute` on the legacy one-time price spelling:
 * `prices.amount` moves to `prices.once` inside its own product, the one key
 * every reader of a one-time price takes. Real files, the real command.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');
const { loadConfig } = require('@omega.js/config');

const { stageBrand, runMigrate } = require('./lib/migrate-harness.js');

const CARRIES_AMOUNT = `// Fixture Brand
{
  brand: {
    id: 'fixture-brand',
    name: 'Fixture Brand',
    url: 'https://fixture-brand.test',
  },

  payment: {
    products: [
      { id: 'kit', name: 'Kit', type: 'one-time', prices: { amount: 9.99 } },
    ],
  },

  targets: {
    web: { type: 'web' }, // keep me
  },
}
`;

const readConfig = (brand) => fs.readFileSync(path.join(brand, 'config', 'omega.json5'), 'utf8');

test('migrate --execute: a one-time `prices.amount` is CONVERTED to `prices.once` (#849)', async () => {
  const brand = stageBrand(CARRIES_AMOUNT);
  const { text } = await runMigrate(brand, { execute: true });

  const parsed = JSON5.parse(readConfig(brand));
  assert.deepEqual(parsed.payment.products[0].prices, { once: 9.99 }, 'the price moved, and the old key is gone');

  const line = text.split('\n').find((entry) => entry.includes('prices.amount'));
  assert.ok(line && line.includes('prices.once'), `the line names both halves of the move: ${text}`);
});

test('migrate --execute: a stray `amount` on a plan moves to `once` and the load then refuses it (#849)', async () => {
  // The row is type-blind, so a subscription's `amount` becomes `once`; the
  // validator refuses `once` on a plan, so the brand hears about it loudly
  const brand = stageBrand(CARRIES_AMOUNT.replace(
    "{ id: 'kit', name: 'Kit', type: 'one-time', prices: { amount: 9.99 } }",
    "{ id: 'plan', name: 'Plan', type: 'subscription', prices: { monthly: 9.99, amount: 9.99 } }",
  ));
  await runMigrate(brand, { execute: true });

  const parsed = JSON5.parse(readConfig(brand));
  assert.deepEqual(parsed.payment.products[0].prices, { monthly: 9.99, once: 9.99 }, 'the row moved it like any other');

  const { errors } = loadConfig(brand);
  assert.ok(errors.some((error) => error.includes('(plan) price "once"') && error.includes('monthly')), `the load refuses it, naming the cadence keys: ${errors.join(' | ')}`);
});

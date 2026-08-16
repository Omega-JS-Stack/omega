/**
 * winback.test.js — the cancel-flow save offer's ONE resolution home
 * ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)).
 *
 * The offer is config-driven per brand (Ian, 2026-08-15) and defaults to 50%
 * off the next cycle, so a brand that writes nothing at all still has an offer
 * to make. That default lives HERE and nowhere else: the backend route reads
 * resolveWinbackOffer(Manager.config.payment) and the web build bakes the same
 * call into the client blob, so neither surface carries a second copy of the
 * number.
 */

const test = require('node:test');
const assert = require('node:assert');
const { resolveWinbackOffer, WINBACK_OFFER_DEFAULTS } = require('../src/winback.js');
const { validateConfig, runSchema } = require('../src/validate.js');
const { SHARED_SCHEMA } = require('../src/schema.js');

// The minimum a config needs to reach the winback rules rather than dying on
// brand.id / brand.name first.
function brandConfig(payment) {
  return {
    brand: { id: 'acme', name: 'Acme' },
    payment: payment,
    targets: { web: {} },
  };
}

test('a brand that configures nothing gets 50% off the next cycle, once', () => {
  const offer = resolveWinbackOffer(undefined);

  assert.deepStrictEqual(offer, { enabled: true, percent: 50, duration: 'once' });
  assert.deepStrictEqual(offer, { ...WINBACK_OFFER_DEFAULTS });
});

test('an empty payment section resolves the same default', () => {
  assert.deepStrictEqual(resolveWinbackOffer({}), { enabled: true, percent: 50, duration: 'once' });
  assert.deepStrictEqual(resolveWinbackOffer({ winback: {} }), { enabled: true, percent: 50, duration: 'once' });
});

test('enabled: false is the whole off switch, and keeps the numbers readable', () => {
  const offer = resolveWinbackOffer({ winback: { enabled: false } });

  assert.strictEqual(offer.enabled, false);
  assert.strictEqual(offer.percent, 50, 'one shape, one switch — the offer still resolves, it is just not made');
});

test('a brand percent overrides the default', () => {
  assert.deepStrictEqual(resolveWinbackOffer({ winback: { percent: 25 } }), { enabled: true, percent: 25, duration: 'once' });
});

test('an amount offer carries amount ONLY — the absent shape is omitted, never undefined', () => {
  const offer = resolveWinbackOffer({ winback: { amount: 10 } });

  assert.deepStrictEqual(offer, { enabled: true, amount: 10, duration: 'once' });
  // Same rule discount-codes.validate() follows: a caller writing this object
  // into Firestore must not carry an undefined field.
  assert.ok(!('percent' in offer), 'an amount offer declares no percent at all');
});

test('duration is one cycle unless the brand says otherwise', () => {
  assert.strictEqual(resolveWinbackOffer({ winback: {} }).duration, 'once');
  assert.strictEqual(resolveWinbackOffer({ winback: { duration: 'forever' } }).duration, 'forever');
});

test('the resolver never mutates the config it reads', () => {
  const payment = { winback: { percent: 25 } };
  const before = JSON.stringify(payment);

  resolveWinbackOffer(payment);

  assert.strictEqual(JSON.stringify(payment), before);
});

test('the schema accepts every winback key a brand may write', () => {
  const errors = runSchema(brandConfig({ winback: { enabled: true, percent: 25, duration: 'forever' } }), SHARED_SCHEMA);

  assert.deepStrictEqual(errors.filter((e) => e.includes('winback')), []);
});

test('the schema rejects a percent that is not a percentage', () => {
  const tooLow = runSchema(brandConfig({ winback: { percent: 0 } }), SHARED_SCHEMA);
  const tooHigh = runSchema(brandConfig({ winback: { percent: 101 } }), SHARED_SCHEMA);

  assert.ok(tooLow.some((e) => e.includes('payment.winback.percent')), `expected a percent error, got ${JSON.stringify(tooLow)}`);
  assert.ok(tooHigh.some((e) => e.includes('payment.winback.percent')), `expected a percent error, got ${JSON.stringify(tooHigh)}`);
});

test('the schema rejects a fractional percent', () => {
  // The percent is baked into a processor's deterministic coupon id
  // (BEM_WINBACK50_50OFF_ONCE), so 12.5 would mint a DOTTED id — a shape no
  // brand asked for and nothing downstream reads back.
  const errors = runSchema(brandConfig({ winback: { percent: 12.5 } }), SHARED_SCHEMA);

  assert.ok(errors.some((e) => e.includes('payment.winback.percent')), `expected a percent error, got ${JSON.stringify(errors)}`);
});

test('the schema rejects a duration the processors cannot build a coupon for', () => {
  const errors = runSchema(brandConfig({ winback: { duration: 'repeating' } }), SHARED_SCHEMA);

  assert.ok(errors.some((e) => e.includes('payment.winback.duration')), `expected a duration error, got ${JSON.stringify(errors)}`);
});

test('the validator refuses an offer that is both percent and amount', () => {
  // A coupon is one shape or the other everywhere in the payment stack. Two
  // shapes on one offer has no honest reading, so it fails the config rather
  // than letting a processor pick one.
  const { errors } = validateConfig(brandConfig({ winback: { percent: 50, amount: 10 } }), { target: 'web' });

  assert.ok(errors.some((e) => e.includes('payment.winback')), `expected a winback error, got ${JSON.stringify(errors)}`);
});

test('the validator passes a brand that configures one shape', () => {
  assert.deepStrictEqual(validateConfig(brandConfig({ winback: { percent: 50 } }), { target: 'web' }).errors, []);
  assert.deepStrictEqual(validateConfig(brandConfig({ winback: { amount: 10 } }), { target: 'web' }).errors, []);
  assert.deepStrictEqual(validateConfig(brandConfig({ winback: { enabled: false } }), { target: 'web' }).errors, []);
});

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

const defineCases = require('@omega.js/devkit/test/define-cases');
const { resolveWinbackOffer, WINBACK_OFFER_DEFAULTS } = require('../src/winback.js');
const { validateConfig, runSchema } = require('../src/validate.js');
const { SHARED_SCHEMA } = require('../src/schema.js');

// The minimum a config needs to reach the winback rules rather than dying on
// brand.id / brand.name first.
function brandConfig(payment) {
  return {
    brand: { id: 'acme', name: 'Acme' },
    payment: payment,
    targets: { web: { type: 'web' } },
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'winback',
  tests: [
    {
      name: 'a brand that configures nothing gets 50% off the next cycle, once',
      run: (ctx) => {
        const offer = resolveWinbackOffer(undefined);

        ctx.expect(offer).toEqual({ enabled: true, percent: 50, duration: 'once' });
        ctx.expect(offer).toEqual({ ...WINBACK_OFFER_DEFAULTS });
      },
    },

    {
      name: 'an empty payment section resolves the same default',
      run: (ctx) => {
        ctx.expect(resolveWinbackOffer({})).toEqual({ enabled: true, percent: 50, duration: 'once' });
        ctx.expect(resolveWinbackOffer({ winback: {} })).toEqual({ enabled: true, percent: 50, duration: 'once' });
      },
    },

    {
      name: 'enabled: false is the whole off switch, and keeps the numbers readable',
      run: (ctx) => {
        const offer = resolveWinbackOffer({ winback: { enabled: false } });

        ctx.expect(offer.enabled).toBe(false);
        ctx.expect(offer.percent, 'one shape, one switch — the offer still resolves, it is just not made').toBe(50);
      },
    },

    {
      name: 'a brand percent overrides the default',
      run: (ctx) => {
        ctx.expect(resolveWinbackOffer({ winback: { percent: 25 } })).toEqual({ enabled: true, percent: 25, duration: 'once' });
      },
    },

    {
      name: 'an amount offer carries amount ONLY — the absent shape is omitted, never undefined',
      run: (ctx) => {
        const offer = resolveWinbackOffer({ winback: { amount: 10 } });

        ctx.expect(offer).toEqual({ enabled: true, amount: 10, duration: 'once' });
        // Same rule discount-codes.validate() follows: a caller writing this object
        // into Firestore must not carry an undefined field.
        ctx.expect(!('percent' in offer), 'an amount offer declares no percent at all').toBeTruthy();
      },
    },

    {
      name: 'duration is one cycle unless the brand says otherwise',
      run: (ctx) => {
        ctx.expect(resolveWinbackOffer({ winback: {} }).duration).toBe('once');
        ctx.expect(resolveWinbackOffer({ winback: { duration: 'forever' } }).duration).toBe('forever');
      },
    },

    {
      name: 'the resolver never mutates the config it reads',
      run: (ctx) => {
        const payment = { winback: { percent: 25 } };
        const before = JSON.stringify(payment);

        resolveWinbackOffer(payment);

        ctx.expect(JSON.stringify(payment)).toBe(before);
      },
    },

    {
      name: 'the schema accepts every winback key a brand may write',
      run: (ctx) => {
        const errors = runSchema(brandConfig({ winback: { enabled: true, percent: 25, duration: 'forever' } }), SHARED_SCHEMA);

        ctx.expect(errors.filter((e) => e.includes('winback'))).toEqual([]);
      },
    },

    {
      name: 'the schema rejects a percent that is not a percentage',
      run: (ctx) => {
        const tooLow = runSchema(brandConfig({ winback: { percent: 0 } }), SHARED_SCHEMA);
        const tooHigh = runSchema(brandConfig({ winback: { percent: 101 } }), SHARED_SCHEMA);

        ctx.expect(tooLow.some((e) => e.includes('payment.winback.percent')), `expected a percent error, got ${JSON.stringify(tooLow)}`).toBeTruthy();
        ctx.expect(tooHigh.some((e) => e.includes('payment.winback.percent')), `expected a percent error, got ${JSON.stringify(tooHigh)}`).toBeTruthy();
      },
    },

    {
      name: 'the schema rejects a fractional percent',
      run: (ctx) => {
        // The percent is baked into a provider's deterministic coupon id
        // (BEM_WINBACK50_50OFF_ONCE), so 12.5 would mint a DOTTED id — a shape no
        // brand asked for and nothing downstream reads back.
        const errors = runSchema(brandConfig({ winback: { percent: 12.5 } }), SHARED_SCHEMA);

        ctx.expect(errors.some((e) => e.includes('payment.winback.percent')), `expected a percent error, got ${JSON.stringify(errors)}`).toBeTruthy();
      },
    },

    {
      name: 'the schema rejects a duration the providers cannot build a coupon for',
      run: (ctx) => {
        const errors = runSchema(brandConfig({ winback: { duration: 'repeating' } }), SHARED_SCHEMA);

        ctx.expect(errors.some((e) => e.includes('payment.winback.duration')), `expected a duration error, got ${JSON.stringify(errors)}`).toBeTruthy();
      },
    },

    {
      name: 'the validator refuses an offer that is both percent and amount',
      run: (ctx) => {
        // A coupon is one shape or the other everywhere in the payment stack. Two
        // shapes on one offer has no honest reading, so it fails the config rather
        // than letting a provider pick one.
        const { errors } = validateConfig(brandConfig({ winback: { percent: 50, amount: 10 } }), { target: 'web' });

        ctx.expect(errors.some((e) => e.includes('payment.winback')), `expected a winback error, got ${JSON.stringify(errors)}`).toBeTruthy();
      },
    },

    {
      name: 'the validator passes a brand that configures one shape',
      run: (ctx) => {
        ctx.expect(validateConfig(brandConfig({ winback: { percent: 50 } }), { target: 'web' }).errors).toEqual([]);
        ctx.expect(validateConfig(brandConfig({ winback: { amount: 10 } }), { target: 'web' }).errors).toEqual([]);
        ctx.expect(validateConfig(brandConfig({ winback: { enabled: false } }), { target: 'web' }).errors).toEqual([]);
      },
    },
  ],
});

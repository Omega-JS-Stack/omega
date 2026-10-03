// Unit tests for src/test/extended-mode-warning.js — the SSOT headline every
// framework prints when TEST_EXTENDED_MODE is on.
//
// The whole point of the shared module is that the WARNING reads identically
// on every surface while each framework supplies its own blast-radius lines,
// so the headline text and the headline-first order are the contract.

const defineCases = require('@omega.js/devkit/test/define-cases');
const { makeExtendedModeWarning } = require('../src/test/extended-mode-warning');

const HEADLINE = '⚠️⚠️⚠️  WARNING: TEST_EXTENDED_MODE IS TRUE  ⚠️⚠️⚠️';

module.exports = defineCases({
  type: 'group',
  description: 'extended-mode-warning',
  tests: [
    {
      name: 'the shared headline leads, framework detail lines follow in order',
      run: (ctx) => {
        const lines = makeExtendedModeWarning([
          'Real emails will be sent through SendGrid.',
          'Real AI provider calls will be billed.',
        ]);

        ctx.expect(lines).toEqual([
          HEADLINE,
          'Real emails will be sent through SendGrid.',
          'Real AI provider calls will be billed.',
        ]);
      },
    },

    {
      name: 'the headline stands alone when a framework supplies no detail',
      run: (ctx) => {
        ctx.expect(makeExtendedModeWarning([])).toEqual([HEADLINE]);
      },
    },

    {
      name: 'every framework gets the SAME headline, whatever it passes',
      run: (ctx) => {
        const web = makeExtendedModeWarning(['web detail']);
        const backend = makeExtendedModeWarning(['backend detail one', 'backend detail two']);

        ctx.expect(web[0]).toBe(backend[0]);
      },
    },

    {
      name: 'the caller array is never mutated — a fresh array comes back',
      run: (ctx) => {
        const detail = ['only line'];
        const lines = makeExtendedModeWarning(detail);

        ctx.expect(detail).toEqual(['only line']);
        ctx.expect(lines).not.toBe(detail);
      },
    },
  ],
});

/**
 * Unit tests for @omega.js/config's merge module — the one agnostic deep
 * merge every config layer composes through.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { deepMerge } = require('../src/index.js');

module.exports = defineCases({
  type: 'group',
  description: 'merge',
  tests: [
    {
      name: 'objects merge recursively, later layers win',
      run: (ctx) => {
        const result = deepMerge(
          { brand: { id: 'a', name: 'A' }, theme: { id: 'classy' } },
          { brand: { name: 'B' } },
        );

        ctx.expect(result).toEqual({ brand: { id: 'a', name: 'B' }, theme: { id: 'classy' } });
      },
    },

    {
      name: 'arrays replace whole — payment.products never concatenates',
      run: (ctx) => {
        const result = deepMerge(
          { payment: { products: [{ id: 'basic' }, { id: 'premium' }] } },
          { payment: { products: [{ id: 'ultimate' }] } },
        );

        ctx.expect(result.payment.products).toEqual([{ id: 'ultimate' }]);
      },
    },

    {
      name: 'null replaces, undefined is skipped',
      run: (ctx) => {
        const result = deepMerge(
          { monitoring: { providers: { sentry: { dsn: 'https://a' } } }, theme: { id: 'classy' } },
          { monitoring: { providers: { sentry: { dsn: null } } }, theme: { id: undefined } },
        );

        ctx.expect(result.monitoring.providers.sentry.dsn).toBe(null);
        ctx.expect(result.theme.id).toBe('classy');
      },
    },

    {
      name: 'falsy layers are skipped — optional brand file / target section',
      run: (ctx) => {
        const result = deepMerge(null, { brand: { id: 'a' } }, undefined, { brand: { name: 'A' } });

        ctx.expect(result).toEqual({ brand: { id: 'a', name: 'A' } });
      },
    },

    {
      name: 'inputs are never mutated and share no references with the result',
      run: (ctx) => {
        const base = { brand: { id: 'a' }, payment: { products: [{ id: 'basic' }] } };
        const overlay = { brand: { name: 'A' } };

        const result = deepMerge(base, overlay);
        result.brand.id = 'changed';
        result.payment.products[0].id = 'changed';

        ctx.expect(base.brand.id).toBe('a');
        ctx.expect(base.payment.products[0].id).toBe('basic');
        ctx.expect(overlay).toEqual({ brand: { name: 'A' } });
      },
    },
  ],
});

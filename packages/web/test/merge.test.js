/**
 * merge.js — the ONE pairwise deep merge behind BOTH the resolved-data
 * cascade and the section tag's defaults ← data ← args chain. Its whole
 * reason for existing is the divergence from @omega.js/config's variadic
 * deepMerge: an explicit null in the later layer must REPLACE, not be
 * skipped as a falsy layer — a consumer clearing a value would otherwise
 * behave differently across the two lanes.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { deepMerge } = require('../src/merge.js');

module.exports = defineCases({
  type: 'group',
  description: 'merge',
  tests: [
    {
      name: 'later keys win and absent keys survive',
      run: (ctx) => {
        ctx.expect(deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
      },
    },

    {
      name: 'nested objects merge pairwise, not wholesale',
      run: (ctx) => {
        ctx.expect(deepMerge({ seo: { title: 'a', description: 'd' } }, { seo: { title: 'b' } })).toEqual({ seo: { title: 'b', description: 'd' } });
      },
    },

    {
      name: 'an explicit null REPLACES — the reason this is not config deepMerge',
      run: (ctx) => {
        ctx.expect(deepMerge({ a: 1 }, { a: null })).toEqual({ a: null });
        ctx.expect(deepMerge({ a: { b: 1 } }, { a: null })).toEqual({ a: null });
        // Every other falsy value replaces too.
        ctx.expect(deepMerge({ a: 1 }, { a: 0 })).toEqual({ a: 0 });
        ctx.expect(deepMerge({ a: 'x' }, { a: '' })).toEqual({ a: '' });
        ctx.expect(deepMerge({ a: true }, { a: false })).toEqual({ a: false });
      },
    },

    {
      name: 'undefined on the later side KEEPS the earlier value',
      run: (ctx) => {
        ctx.expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
        ctx.expect(deepMerge('kept', undefined)).toBe('kept');
      },
    },

    {
      name: 'arrays replace wholesale — they are values, not containers to merge',
      run: (ctx) => {
        ctx.expect(deepMerge({ tags: ['a', 'b'] }, { tags: ['c'] })).toEqual({ tags: ['c'] });
        ctx.expect(deepMerge({ a: { b: 1 } }, { a: ['x'] })).toEqual({ a: ['x'] });
        ctx.expect(deepMerge(['a'], { b: 1 })).toEqual({ b: 1 });
      },
    },

    {
      name: 'a scalar on either side means replace, never merge',
      run: (ctx) => {
        ctx.expect(deepMerge(1, 2)).toBe(2);
        ctx.expect(deepMerge({ a: 1 }, 'scalar')).toEqual('scalar');
        ctx.expect(deepMerge('scalar', { a: 1 })).toEqual({ a: 1 });
      },
    },

    {
      name: 'neither side is mutated — fresh containers all the way down',
      run: (ctx) => {
        const a = { seo: { title: 'a' }, keep: [1] };
        const b = { seo: { description: 'd' } };
        const out = deepMerge(a, b);

        out.seo.title = 'MUTATED';
        out.keep.push(2);

        ctx.expect(a, 'arrays pass by reference (values, not merged containers)').toEqual({ seo: { title: 'a' }, keep: [1, 2] });
        ctx.expect(b).toEqual({ seo: { description: 'd' } });
        ctx.expect(a.seo.title, 'nested objects are fresh').toBe('a');
        ctx.expect(out.seo).not.toBe(a.seo);
      },
    },

    {
      name: 'null on the EARLIER side is replaced by the later object',
      run: (ctx) => {
        ctx.expect(deepMerge({ a: null }, { a: { b: 1 } })).toEqual({ a: { b: 1 } });
        ctx.expect(deepMerge(null, { a: 1 })).toEqual({ a: 1 });
      },
    },

    {
      name: 'three-deep cascade composes left to right',
      run: (ctx) => {
        const defaults = { section: { theme: 'classy', pad: { top: 1, bottom: 1 } } };
        const data = { section: { pad: { top: 2 } } };
        const args = { section: { theme: 'newsflash', pad: { bottom: null } } };

        ctx.expect(deepMerge(deepMerge(defaults, data), args)).toEqual({ section: { theme: 'newsflash', pad: { top: 2, bottom: null } } });
      },
    },
  ],
});

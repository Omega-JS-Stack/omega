/**
 * serializeSuite: a normalized suite as the plain data a page or a worker
 * receives, every function its body text (fn-source.js). The spec file below
 * is a fixed name, so every id and source is written out by hand.
 */
const defineCases = require('../../src/test/define-cases.js');
const { normalizeSpec } = require('../../src/test/run-case.js');
const { serializeSuite } = require('../../src/test/serialize.js');

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const FILE = '/fixtures/serialized-subject.test.js';

const serialized = (spec) => serializeSuite(normalizeSpec(spec, { file: FILE }));

module.exports = defineCases({
  type: 'group',
  description: 'serialize: a suite as data a page or a worker rebuilds',
  tests: [
    {
      name: 'case-177 a group serializes to its suite keys and case keys, undefined keys absent',
      run: (ctx) => {
        const result = serialized({
          type: 'group',
          description: 'a serialized group',
          timeout: 4000,
          setup: (ctx) => ctx.expect(ctx.state).toEqual({}),
          cleanup: (ctx) => ctx.expect(ctx.state).toBeDefined(),
          tests: [
            {
              name: 'first case',
              timeout: 2000,
              run: (ctx) => ctx.expect(1 + 1).toBe(2),
              cleanup: (ctx) => ctx.expect(true).toBe(true),
            },
            {
              name: 'skipped case',
              skip: 'not today',
              run: (ctx) => ctx.expect(2).toBe(3),
            },
          ],
        });

        ctx.expect(result).toEqual({
          file: FILE,
          description: 'a serialized group',
          type: 'group',
          stopOnFailure: false,
          timeout: 4000,
          setupSource: 'return (\nctx.expect(ctx.state).toEqual({})\n);',
          cleanupSource: 'return (\nctx.expect(ctx.state).toBeDefined()\n);',
          cases: [
            {
              id: `${FILE}#0`,
              name: 'first case',
              timeout: 2000,
              runSource: 'return (\nctx.expect(1 + 1).toBe(2)\n);',
              cleanupSource: 'return (\nctx.expect(true).toBe(true)\n);',
            },
            {
              id: `${FILE}#1`,
              name: 'skipped case',
              skip: 'not today',
              runSource: 'return (\nctx.expect(2).toBe(3)\n);',
            },
          ],
        });
      },
    },
    {
      name: 'case-177 a standalone spec with view carries the view on the suite',
      run: (ctx) => {
        const result = serialized({
          description: 'a standalone view suite',
          layer: 'boot',
          view: 'main',
          run: (ctx) => ctx.expect(ctx.page).toBeDefined(),
        });

        ctx.expect(result).toEqual({
          file: FILE,
          description: 'a standalone view suite',
          type: 'standalone',
          stopOnFailure: false,
          view: 'main',
          cases: [
            {
              id: `${FILE}#0`,
              name: 'a standalone view suite',
              runSource: 'return (\nctx.expect(ctx.page).toBeDefined()\n);',
            },
          ],
        });
      },
    },
    {
      name: 'case-178 a body that takes a parameter other than ctx rebuilds to a throw naming the file and the case',
      run: async (ctx) => {
        const result = serialized({
          type: 'group',
          tests: [
            { name: 'reads the page', run: ({ page }) => page },
            { name: 'plain case', run: (ctx) => ctx.expect(1).toBe(1) },
          ],
        });
        const [refused, intact] = result.cases;
        const rebuilt = new AsyncFunction('ctx', refused.runSource);

        await ctx.expect(() => rebuilt({ page: {} })).toThrow(FILE);
        await ctx.expect(() => rebuilt({ page: {} })).toThrow('reads the page');
        ctx.expect(intact.runSource).toBe('return (\nctx.expect(1).toBe(1)\n);');
      },
    },
  ],
});

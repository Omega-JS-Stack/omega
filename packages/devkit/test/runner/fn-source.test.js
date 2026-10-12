/**
 * fnSource: a case body's text, the form a page or worker rebuilds it from.
 * Each subject's body text is rebuilt as an async function of `ctx` and must
 * give the result written beside it; a function with no readable source throws.
 */
const defineCases = require('../../src/test/define-cases.js');
const expect = require('../../src/test/expect.js');
const { fnSource } = require('../../src/test/fn-source.js');

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const CTX = { a: 2, b: 5 };

// An async rebuild takes a body that awaits and a plain one alike.
const rebuild = (fn) => new AsyncFunction('ctx', fnSource(fn));

const SUBJECTS = [
  {
    form: 'async arrow with a block body',
    fn: async (ctx) => {
      const value = await Promise.resolve(ctx.a);
      return value + ctx.b;
    },
    expected: 7,
  },
  {
    form: 'expression-bodied arrow',
    fn: (ctx) => ctx.a * ctx.b,
    expected: 10,
  },
  {
    form: 'plain function',
    fn: function plain(ctx) {
      return [ctx.a, ctx.b].join('-');
    },
    expected: '2-5',
  },
  {
    form: 'async method shorthand',
    fn: ({
      async run(ctx) {
        await null;
        return { sum: ctx.a + ctx.b };
      },
    }).run,
    expected: { sum: 7 },
  },
  {
    form: 'function holding a nested arrow with braces',
    fn: function nested(ctx) {
      const add = (x) => { return x + ctx.b; };
      return [ctx.a, 10].map((n) => { return add(n); });
    },
    expected: [7, 15],
  },
];

module.exports = defineCases({
  type: 'group',
  description: 'fn-source: a function body as rebuildable text',
  tests: [
    {
      name: 'case-156 each function form gives body text that rebuilds to the same result',
      run: async (ctx) => {
        for (const { form, fn, expected } of SUBJECTS) {
          ctx.expect(typeof fnSource(fn), form).toBe('string');
          ctx.expect(await fn({ ...CTX }), form).toEqual(expected);
          ctx.expect(await rebuild(fn)({ ...CTX }), form).toEqual(expected);
        }
      },
    },
    {
      name: 'case-156 a bound or a native function throws naming the function',
      run: (ctx) => {
        function boundSubject(input) {
          return input.a;
        }
        ctx.expect(() => fnSource(boundSubject.bind(null))).toThrow('boundSubject');
        ctx.expect(() => fnSource(Math.max)).toThrow('max');
      },
    },
    {
      name: 'case-156 a function whose parameter is not ctx throws naming the parameter',
      run: (ctx) => {
        ctx.expect(() => fnSource(({ a }) => a)).toThrow('({ a })');
        ctx.expect(() => fnSource(async (c) => c.a)).toThrow('(c)');
        ctx.expect(() => fnSource((ctx, extra) => ctx.a + extra)).toThrow('(ctx, extra)');
        ctx.expect(fnSource(() => 1)).toBe('return (\n1\n);');
        ctx.expect(fnSource(async ctx => ctx.a)).toBe('return (\nctx.a\n);');
      },
    },
    {
      name: 'an expression-bodied arrow whose body starts after a comment rebuilds to a body that runs it',
      run: async (ctx) => {
        const afterLineComment = (ctx) => // the comment ends the line
          ctx.expect(ctx.a).toBe(3);
        const afterBlockComment = (ctx) => /* a comment
          over two lines */ ctx.expect(ctx.a).toBe(3);

        for (const fn of [afterLineComment, afterBlockComment]) {
          ctx.expect(() => fn({ ...CTX, expect })).toThrow('3');
          await ctx.expect(rebuild(fn)({ ...CTX, expect })).rejects.toThrow('3');
        }
      },
    },
  ],
});

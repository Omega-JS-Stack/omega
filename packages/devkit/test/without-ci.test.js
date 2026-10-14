/**
 * withoutCI: a case runs with the CI flags lifted and gets them back as they
 * were, whether its body returns, throws, or settles a promise later. The real
 * process.env, set and restored by each case around the call it makes.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { withoutCI } = require('@omega.js/devkit/test/without-ci');

const FLAGS = ['CI', 'GITHUB_ACTIONS'];

/** Set each flag to `value` (undefined deletes it), handing the shell's own back after the case. */
function setFlags(ctx, value) {
  const prior = FLAGS.map((name) => [name, process.env[name]]);
  ctx.after(() => {
    for (const [name, old] of prior) {
      if (old === undefined) delete process.env[name];
      else process.env[name] = old;
    }
  });
  for (const name of FLAGS) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/** Which flags are present, and as what. */
const present = () => FLAGS.filter((name) => name in process.env).map((name) => `${name}=${process.env[name]}`);

module.exports = defineCases({
  type: 'group',
  description: 'without-ci',
  tests: [
    {
      name: 'CI and GITHUB_ACTIONS set: both are absent inside fn and both are back after it',
      run: (ctx) => {
        setFlags(ctx, 'true');

        let inside = null;
        const result = withoutCI(() => {
          inside = present();
          return 'answer';
        });

        ctx.expect(inside, 'inside fn').toEqual([]);
        ctx.expect(result, 'fn\'s return comes back').toBe('answer');
        ctx.expect(present(), 'after fn').toEqual(['CI=true', 'GITHUB_ACTIONS=true']);
      },
    },

    {
      name: 'both absent before: both are still absent after fn, never an "undefined" string',
      run: (ctx) => {
        setFlags(ctx, undefined);

        withoutCI(() => {});

        ctx.expect(present()).toEqual([]);
      },
    },

    {
      name: 'fn throws: both flags are restored and the error propagates',
      run: async (ctx) => {
        setFlags(ctx, 'true');
        const boom = new Error('the case body failed');

        ctx.expect(() => withoutCI(() => { throw boom; })).toThrow('the case body failed');
        ctx.expect(present(), 'after a sync throw').toEqual(['CI=true', 'GITHUB_ACTIONS=true']);

        await ctx.expect(withoutCI(async () => { throw boom; })).rejects.toThrow('the case body failed');
        ctx.expect(present(), 'after an async rejection').toEqual(['CI=true', 'GITHUB_ACTIONS=true']);
      },
    },

    {
      name: 'fn returns a promise: the restore waits for it to settle',
      run: async (ctx) => {
        setFlags(ctx, 'true');

        let afterAwait = null;
        const pending = withoutCI(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          afterAwait = present();
          return 'settled';
        });

        ctx.expect(present(), 'still lifted while the promise is pending').toEqual([]);
        ctx.expect(await pending, 'the promise resolves to fn\'s value').toBe('settled');
        ctx.expect(afterAwait, 'lifted across fn\'s own await').toEqual([]);
        ctx.expect(present(), 'restored once it settled').toEqual(['CI=true', 'GITHUB_ACTIONS=true']);
      },
    },
  ],
});

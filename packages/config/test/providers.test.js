/**
 * providers.js — the one provider shape (#425). Key presence in a role's
 * `providers` block IS the pick, so this read replaces every flat
 * `provider: 'x'` string the config used to carry. The tri-state (absent =
 * unset, `false` = disabled, object = chosen) is the contract every
 * single-provider role gates on, which is why it is pinned here.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { chosenProvider } = require('../src/index.js');

module.exports = defineCases({
  type: 'group',
  description: 'providers',
  tests: [
    {
      name: 'the present key is the chosen provider',
      run: (ctx) => {
        ctx.expect(chosenProvider({ namecheap: {} })).toBe('namecheap');
        ctx.expect(chosenProvider({ ghostii: { orgs: [] } })).toBe('ghostii');
        // An empty entry still opts in — presence is the pick, not the contents.
        ctx.expect(chosenProvider({ chatgpt: {} })).toBe('chatgpt');
      },
    },

    {
      name: 'no block, an empty block, or a non-object is nothing chosen',
      run: (ctx) => {
        ctx.expect(chosenProvider(undefined)).toBe(null);
        ctx.expect(chosenProvider(null)).toBe(null);
        ctx.expect(chosenProvider({})).toBe(null);
        ctx.expect(chosenProvider('cloudflare')).toBe(null);
        ctx.expect(chosenProvider([{ cloudflare: {} }])).toBe(null);
      },
    },

    {
      name: 'false is the deliberate off switch, and the next live entry wins',
      run: (ctx) => {
        ctx.expect(chosenProvider({ squarespace: false })).toBe(null);
        ctx.expect(chosenProvider({ squarespace: false, namecheap: {} })).toBe('namecheap');
      },
    },
  ],
});

/**
 * isCI: the one answer to "is this a CI runner", read by every lane that acts
 * differently there. Real env objects, no process.env.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { isCI } = require('../src/ci.js');

module.exports = defineCases({
  type: 'group',
  description: 'ci',
  tests: [
    {
      name: 'GITHUB_ACTIONS=true or CI=true is a CI runner (#1027)',
      run: (ctx) => {
        ctx.expect(isCI({ GITHUB_ACTIONS: 'true' })).toBe(true);
        ctx.expect(isCI({ CI: 'true' })).toBe(true);
        ctx.expect(isCI({ GITHUB_ACTIONS: 'true', CI: 'true' })).toBe(true);
      },
    },

    {
      name: 'neither variable is a local machine (#1027)',
      run: (ctx) => {
        ctx.expect(isCI({})).toBe(false);
        ctx.expect(isCI({ HOME: '/Users/dev', NODE_ENV: 'production' })).toBe(false);
      },
    },
  ],
});

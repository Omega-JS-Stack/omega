/**
 * demo.js — the shared demo-project test. Firebase's own convention:
 * `demo-*` project ids are emulator-only, and every cloud-touching service
 * short-circuits on them, so the truth table is a wire-visible contract.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { isDemoProject } = require('../src/index.js');

module.exports = defineCases({
  type: 'group',
  description: 'demo',
  tests: [
    {
      name: 'demo-* project ids are demo projects',
      run: (ctx) => {
        ctx.expect(isDemoProject('demo-omega')).toBe(true);
        ctx.expect(isDemoProject('demo-sandbox-brand')).toBe(true);
        // The bare prefix counts — Firebase accepts `demo-` as a valid emulator id.
        ctx.expect(isDemoProject('demo-')).toBe(true);
      },
    },

    {
      name: 'real project ids are not demo projects',
      run: (ctx) => {
        ctx.expect(isDemoProject('omegajs')).toBe(false);
        ctx.expect(isDemoProject('omegajs-playground')).toBe(false);
        // The prefix must LEAD — a mid-string match is a real project.
        ctx.expect(isDemoProject('my-demo-project')).toBe(false);
        // Case-sensitive: Firebase project ids are lowercase, so `Demo-` is real.
        ctx.expect(isDemoProject('Demo-omega')).toBe(false);
        ctx.expect(isDemoProject('demo')).toBe(false);
      },
    },

    {
      name: 'absent or non-string ids are not demo projects',
      run: (ctx) => {
        ctx.expect(isDemoProject(undefined)).toBe(false);
        ctx.expect(isDemoProject(null)).toBe(false);
        ctx.expect(isDemoProject('')).toBe(false);
        ctx.expect(isDemoProject(0)).toBe(false);
        ctx.expect(isDemoProject({})).toBe(false);
      },
    },
  ],
});

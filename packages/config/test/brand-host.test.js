// src/brand-host.js is the one home of `resolvedBrandHost`, the host every
// persona address and the authDomain check derive from. The rows live in
// _brand-host-cases.js, shared with the web dev palette's suite.

const defineCases = require('@omega.js/devkit/test/define-cases');

const { resolvedBrandHost } = require('../src/brand-host.js');
const CASES = require('./_brand-host-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'brand-host',
  tests: [
    {
      name: 'resolvedBrandHost answers every row of the shared case table',
      run: (ctx) => {
        for (const row of CASES) {
          ctx.expect(resolvedBrandHost(row.config), row.name).toBe(row.host);
        }
      },
    },
  ],
});

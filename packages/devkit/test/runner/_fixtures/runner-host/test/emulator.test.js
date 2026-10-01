const defineCases = require('../../../../../src/test/define-cases.js');

// Each case checks that its ctx carries what the driver's extras(caseInfo) returned for it.
const checkExtras = (name) => (ctx) => {
  globalThis.__runnerCalls.push(`case:${name}`);
  ctx.expect(ctx.http).toEqual({ forCase: name });
};

module.exports = defineCases({
  type: 'group',
  description: 'host suite with extras',
  layer: 'emulator',
  tests: [
    { name: 'first host case', run: checkExtras('first host case') },
    { name: 'second host case', run: checkExtras('second host case') },
  ],
});

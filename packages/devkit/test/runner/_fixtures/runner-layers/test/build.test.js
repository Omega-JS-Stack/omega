const defineCases = require('../../../../../src/test/define-cases.js');

module.exports = defineCases({
  type: 'group',
  description: 'build row suite',
  layer: 'build',
  tests: [
    { name: 'build case', run: (ctx) => ctx.expect(ctx.layer).toBe('build') },
  ],
});

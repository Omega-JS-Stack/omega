const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'case-122-null-code backend suite',
  auth: 'none',
  tests: [
    {
      name: 'error codes',
      auth: 'admin',
      async run({ assert, http }) {
        const r = await http.get('x');
        assert.isError(r, null, 'm');
        assert.isError(r, undefined);
        assert.isError(r, 401, 'm');
      },
    },
  ],
});

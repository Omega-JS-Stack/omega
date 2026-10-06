const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'case-125 refused method',
  auth: 'none',
  tests: [
    {
      name: 'status',
      async run({ assert, http }) {
        const r = await http.get('x');
        assert.ok(r);
        assert.statusCode(r, 200);
      },
    },
  ],
});

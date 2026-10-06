const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'case-122 backend suite',
  auth: 'none',
  tests: [
    {
      name: 'admin case',
      auth: 'admin',
      async run({ assert, http }) {
        const r = await http.get('x');
        const o = { a: { b: 1 } };
        const v = [2];
        const a = [1];
        assert.isSuccess(r, 'm');
        assert.isError(r, 401);
        assert.hasProperty(o, 'a.b');
        assert.propertyEquals(o, 'a.b', 1, 'm');
        assert.isType(v, 'array');
        assert.contains(a, 1);
        assert.inRange(v, 1, 3, 'm');
        if (!v) assert.fail('m');
      },
    },
  ],
});

// The standalone form of a boot suite bound to a project VIEW: one `run`, no `tests`
// list. It runs in the fixture's built main view like view-suite.test.js beside it,
// and a `--filter` matching its description keeps it. `run` is serialized into the page.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  layer: 'boot',
  view: 'main',
  description: 'view suite standalone: the fixture consumer main view runs a one-test suite',
  run: (ctx) => {
    ctx.expect(Boolean(ctx.page.document.getElementById('fixture-root'))).toBe(true);
  },
});

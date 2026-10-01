// The standalone form of a renderer suite bound to a project VIEW: one `run`, no `tests`
// list. It rides the boot lane like view-suite.test.js beside it, runs in the fixture's
// built main view, and a `--filter` matching its description keeps it.
//
// NOTE: `run` is serialized into the page, so it closes over nothing from this module.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  layer: 'renderer',
  view: 'main',
  description: 'view suite standalone: the fixture consumer main view runs a one-test suite',
  run: (ctx) => {
    ctx.expect(Boolean(document.getElementById('fixture-root'))).toBe(true);
  },
});

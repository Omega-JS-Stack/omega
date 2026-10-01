// The standalone form of a suite naming a view: one `run`, no `tests` list. It rides the
// boot lane like the suite form beside it, runs in the project's own built page, and a
// `--filter` matching its description keeps it.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  layer: 'view',
  view: 'popup',
  description: 'view/project-view-standalone: a standalone suite naming a view opens the project\'s built page',
  run: async (ctx) => {
    ctx.expect(location.pathname).toBe('/views/popup/index.html');
  },
});

// A boot suite that names a view: it runs in the PROJECT's own built
// views/popup/index.html, inside the project's loaded extension, never on the
// harness page. Every scaffolded project builds a popup view, and every built
// view loads the build snapshot first.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  view: 'popup',
  timeout: 45000,
  description: 'boot/project-view: a suite naming a view opens the project\'s built page',
  tests: [
    {
      name: 'the page is the project\'s views/popup/index.html',
      run: async (ctx) => {
        ctx.expect(ctx.page.location.pathname).toBe('/views/popup/index.html');
      },
    },
    {
      name: 'the page runs inside the project\'s extension, not the harness',
      run: async (ctx) => {
        ctx.expect(chrome.runtime.getManifest().name).not.toBe('OMEGA Test Harness');
      },
    },
    {
      name: 'the page carries the project\'s build snapshot',
      run: async (ctx) => {
        ctx.expect(typeof self.OMEGA_BUILD_JSON).toBe('object');
        ctx.expect(typeof self.OMEGA_BUILD_JSON.config.brand.id).toBe('string');
      },
    },
  ],
});

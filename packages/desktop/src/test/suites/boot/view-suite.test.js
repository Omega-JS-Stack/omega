// Renderer suite bound to a project VIEW (`view: 'main'`), run against the bundled fixture
// consumer. This is the framework's proof of the knob itself: the page under assertion is
// `fixtures/consumer-app/src/views/main/index.html` as BUILT, loaded in a real window of the
// booted fixture app, with the fixture's own preload (`src/preload.js`) attached.
//
// It lives under boot/ because it needs that booted app: framework boot/ suites are
// self-test only, and the runner partitions a `view:` suite into the boot lane.
//
// NOTE: `run` bodies are serialized into the page, so they close over nothing from this
// module. `ctx` plus the page globals (`window`, `document`) is all they get.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'renderer',
  view: 'main',
  description: 'view suite: the fixture consumer main view (real page, real preload)',
  tests: [
    {
      name: 'the fixture view markup is the page, not the harness page',
      run: (ctx) => {
        ctx.expect(Boolean(document.getElementById('fixture-root'))).toBe(true);
        ctx.expect(Boolean(document.querySelector('p.text-muted'))).toBe(true);
      },
    },

    {
      // config/omega.json5 declares brand.name and no app.productName, so the build
      // templates the derived product name into the heading.
      name: 'the heading carries the fixture configured product name',
      run: (ctx) => {
        ctx.expect(document.querySelector('h1').textContent.trim()).toBe('Desktop Fixture Consumer');
      },
    },

    {
      // The fixture's own src/preload.js, not the renderer harness preload.
      name: 'the project preload exposed window.desktop to the page',
      run: (ctx) => {
        ctx.expect(typeof window.desktop).toBe('object');
        ctx.expect(typeof window.desktop.storage).toBe('object');
        ctx.expect(typeof window.desktop.storage.get).toBe('function');
      },
    },
  ],
});

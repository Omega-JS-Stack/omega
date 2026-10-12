/**
 * The page engine: runs serialized suites (devkit's test/serialize.js) inside a page,
 * on the harness page (renderer.html) and in a booted app's view window alike.
 *
 * In a page it talks to `window.__omegaTest`: `onSuites(handler)` hands it
 * `{ sources: { runCase, expect }, suites, layer }`, each case event goes back
 * through `emit(event)`, and `done(error?)` ends the run. devkit's run-case.js
 * and expect.js arrive as text, so the page runs the one `runSuite` and the one
 * `expect`. Loaded by `require` (boot-entry.js), it exports `rebuildSuite` instead.
 */

const pageEngine = (function () {
  'use strict';

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  // Evaluate one devkit module's text; its `typeof module` guard fills the stub.
  function loadModule(text) {
    const stub = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('module', text)(stub);
    return stub.exports;
  }

  // A body as a function of ctx; `globals` are extra names the body sees (a main process's `require`).
  function rebuild(source, file, label, globals) {
    if (source === undefined || source === null) return undefined;
    const names = Object.keys(globals);
    try {
      const fn = new AsyncFunction('ctx', ...names, source);
      return (ctx) => fn(ctx, ...names.map((name) => globals[name]));
    } catch (e) {
      const error = new Error(`${file}: ${label} could not be rebuilt: ${e.message}`);
      return () => { throw error; };
    }
  }

  /**
   * A serialized suite with its bodies rebuilt, ready for run-case.js's `runSuite`.
   * @param {object} suite - From devkit's serializeSuite.
   * @param {string} layer - The ctx.layer its cases see.
   * @param {object} [globals] - Extra names every body sees, by name.
   * @returns {object} A normalized suite.
   */
  function rebuildSuite(suite, layer, globals) {
    const extra = globals || {};
    return {
      ...suite,
      layer,
      setup: rebuild(suite.setupSource, suite.file, 'the suite setup', extra),
      cleanup: rebuild(suite.cleanupSource, suite.file, 'the suite cleanup', extra),
      cases: suite.cases.map((caseDef) => ({
        ...caseDef,
        run: rebuild(caseDef.runSource, suite.file, `"${caseDef.name}" run`, extra),
        cleanup: rebuild(caseDef.cleanupSource, suite.file, `"${caseDef.name}" cleanup`, extra),
      })),
    };
  }

  async function runAll(bridge, { sources, suites, layer }) {
    const { runSuite } = loadModule(sources.runCase);
    const expect = loadModule(sources.expect);
    for (const suite of suites) {
      await runSuite(rebuildSuite(suite, layer), {
        expect,
        extras: { page: window },
        report: (event) => bridge.emit(event),
      });
    }
  }

  function start(bridge) {
    bridge.onSuites((payload) => {
      runAll(bridge, payload).then(
        () => bridge.done(),
        (e) => bridge.done(e && e.stack ? e.stack : String(e)),
      );
    });
    bridge.ready();
  }

  return { rebuildSuite, start };
})();

// Only a CommonJS loader has `module`; a page starts the engine on its bridge.
if (typeof module !== 'undefined') {
  module.exports = { rebuildSuite: pageEngine.rebuildSuite };
} else {
  pageEngine.start(window.__omegaTest);
}

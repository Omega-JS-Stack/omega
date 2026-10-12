/**
 * How the `renderer` row's harness page run ends (harness/main-entry.js): its case
 * events arrive over `ipcMain`, and the run ends on the page's `__omegaTest:done`, a
 * failed load, a renderer gone, or the ceiling with no end event at all.
 */

const { createEventTracker } = require('@omega.js/devkit/test/events');

// How long the harness page gets to send its end event.
const RENDERER_CEILING_MS = 60000;

/**
 * Wait for the harness page's run to end, reporting every case event it sends.
 * @param {object} options - `{ ipc, contents, load, cases, report, ceilingMs }`: `ipc` is
 *   `ipcMain`, `contents` the window's webContents, `load()` starts the page, `cases` the cases it runs.
 * @returns {Promise<void>} Resolves on a clean end; any other end fails the unreported cases
 *   with its error and rejects with it.
 */
function awaitRendererRun({ ipc, contents, load, cases, report, ceilingMs = RENDERER_CEILING_MS }) {
  const events = createEventTracker(report);
  return new Promise((resolve, reject) => {
    let ended = false;
    const ceiling = setTimeout(() => {
      end(new Error(`renderer harness timed out (no end event in ${Math.round(ceilingMs / 1000)}s)`));
    }, ceilingMs);

    function end(error) {
      if (ended) return;
      ended = true;
      clearTimeout(ceiling);
      if (!error) {
        resolve();
        return;
      }
      events.settle(cases, error);
      reject(error);
    }

    ipc.on('__omegaTest:result', (_e, event) => { if (!ended) events.onEvent(event); });
    ipc.once('__omegaTest:done', (_e, error) => end(error ? new Error(`renderer page engine: ${error}`) : null));
    contents.once('did-fail-load', (_e, code, desc) => end(new Error(`renderer load failed: ${desc} (${code})`)));
    contents.once('render-process-gone', (_e, details) => end(new Error(`renderer process gone: ${details.reason}`)));
    Promise.resolve().then(load).catch(end);
  });
}

module.exports = { awaitRendererRun };

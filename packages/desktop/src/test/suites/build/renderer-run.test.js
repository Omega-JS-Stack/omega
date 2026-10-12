// Build-layer test for how the renderer row's harness page run ends (harness/renderer-run.js).
// `ipcMain` and a webContents are EventEmitters that need a running Electron, so two plain
// EventEmitters carry the same events here.

const { EventEmitter } = require('events');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { awaitRendererRun } = require('../../harness/renderer-run.js');

const CASES = [{ id: 'renderer/a.test.js#0', name: 'A' }, { id: 'renderer/a.test.js#1', name: 'B' }];

// A page that reports its first case, then `then(ipc, contents)`; resolves to how the run ended and every event reported.
async function pageRun({ then, ceilingMs }) {
  const ipc = new EventEmitter();
  const contents = new EventEmitter();
  const events = [];
  const load = () => {
    ipc.emit('__omegaTest:result', {}, { id: CASES[0].id, name: 'A', status: 'pass', durationMs: 1 });
    then(ipc, contents);
  };
  const run = awaitRendererRun({ ipc, contents, load, cases: CASES, report: (event) => events.push(event), ceilingMs });
  const error = await run.then(() => null, (e) => e);
  await new Promise((resolve) => setTimeout(resolve, ceilingMs * 2));
  return { error, events };
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'the renderer harness page run: its end and its ceiling',
  tests: [
    {
      name: 'a harness page with no end event within the ceiling fails its unreported cases with the timeout, and the run rejects',
      timeout: 5000,
      run: async (ctx) => {
        const { error, events } = await pageRun({ then: () => {}, ceilingMs: 50 });

        ctx.expect(error.message).toContain('renderer harness timed out (no end event in');
        ctx.expect(events.map((event) => [event.id, event.status])).toEqual([
          [CASES[0].id, 'pass'],
          [CASES[1].id, 'fail'],
        ]);
        ctx.expect(events[1].error.message).toBe(error.message);
      },
    },
    {
      name: 'a harness page that ends cleanly resolves the run, and no case fails after it',
      timeout: 5000,
      run: async (ctx) => {
        const then = (ipc) => {
          ipc.emit('__omegaTest:result', {}, { id: CASES[1].id, name: 'B', status: 'pass', durationMs: 1 });
          ipc.emit('__omegaTest:done', {}, null);
        };
        const { error, events } = await pageRun({ then, ceilingMs: 50 });

        ctx.expect(error).toBeNull();
        ctx.expect(events.map((event) => [event.id, event.status])).toEqual([
          [CASES[0].id, 'pass'],
          [CASES[1].id, 'pass'],
        ]);
      },
    },
    ...[
      ['a page engine that ends with an error', (ipc) => ipc.emit('__omegaTest:done', {}, 'engine broke'), 'renderer page engine: engine broke'],
      ['a page that fails to load', (_ipc, contents) => contents.emit('did-fail-load', {}, -6, 'FILE_NOT_FOUND'), 'renderer load failed: FILE_NOT_FOUND (-6)'],
      ['a page whose renderer process goes', (_ipc, contents) => contents.emit('render-process-gone', {}, { reason: 'crashed' }), 'renderer process gone: crashed'],
    ].map(([what, then, message]) => ({
      name: `${what} fails its unreported cases with that cause, and the run rejects`,
      timeout: 5000,
      run: async (ctx) => {
        const { error, events } = await pageRun({ then, ceilingMs: 50 });

        ctx.expect(error.message).toBe(message);
        ctx.expect(events.map((event) => [event.id, event.status])).toEqual([
          [CASES[0].id, 'pass'],
          [CASES[1].id, 'fail'],
        ]);
        ctx.expect(events[1].error.message).toBe(message);
      },
    })),
  ],
});

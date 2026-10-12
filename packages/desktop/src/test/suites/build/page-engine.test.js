// Build-layer test for the page engine a renderer or view suite runs on: the real
// harness/renderer-entry.js in a `vm` context standing in for the page, fed serialized
// suites and devkit's run-case.js and expect.js as text, through a stub bridge or through
// the boot harness's own view loop (boot-entry.js `runViewSuite`).

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { normalizeSpec } = require('@omega.js/devkit/test/run-case');
const { serializeSuite } = require('@omega.js/devkit/test/serialize');
const { engineSources } = require('../../harness/engine-sources.js');
const { runViewSuite } = require('../../harness/boot-entry.js');

const RENDERER_ENTRY = path.join(__dirname, '..', '..', 'harness', 'renderer-entry.js');
const FILE = 'renderer/page-engine.test.js';

// The suite a host serializes: one passing case, one failing, one skipped.
const SPEC = {
  type: 'group',
  description: 'page engine probe',
  tests: [
    {
      name: 'reads the page through ctx',
      run: async (ctx) => {
        await ctx.waitFor(() => true);
        ctx.expect(ctx.page === window).toBe(true);
      },
    },
    {
      name: 'fails with a stack',
      run: (ctx) => {
        ctx.expect(1).toBe(2);
      },
    },
    {
      name: 'skipped on this page',
      skip: 'not on this page',
      run: (ctx) => {
        ctx.expect.fail('a skipped case never runs');
      },
    },
  ],
};

// Run the real page engine on `payload` in a fresh context; resolves to the emitted events.
function runPageEngine(payload) {
  return new Promise((resolve, reject) => {
    const events = [];
    const bridge = {
      ready() {},
      emit(event) { events.push(JSON.parse(JSON.stringify(event))); },
      done(error) { if (error) reject(new Error(String(error))); else resolve(events); },
      onSuites(handler) { setImmediate(() => handler(payload)); },
    };
    const page = vm.createContext({ setTimeout, clearTimeout, console });
    vm.runInContext('globalThis.window = globalThis;', page);
    page.window.__omegaTest = bridge;
    vm.runInContext(fs.readFileSync(RENDERER_ENTRY, 'utf8'), page, { filename: RENDERER_ENTRY });
  });
}

// A view suite whose second case ends only when the page gets a turn after a queue read.
const GATED_VIEW = {
  type: 'group',
  layer: 'boot',
  view: 'main',
  description: 'a view suite ending between two polls',
  tests: [
    { name: 'reports at once', run: (ctx) => { ctx.expect(1).toBe(1); } },
    { name: 'ends after a queue read', run: async () => { await new Promise((resolve) => { window.__finish = resolve; }); } },
  ],
};

const PLAIN_VIEW = {
  type: 'group',
  layer: 'boot',
  view: 'main',
  description: 'a plain view suite',
  tests: [{ name: 'reads the page', run: (ctx) => { ctx.expect(ctx.page === window).toBe(true); } }],
};

// A view window as boot-entry.js drives it, over a vm page: a real Electron window needs a
// booted app. `executeJavaScript` evaluates in the page and returns a structured copy, and
// the page gets one turn right after a queue read, as an IPC round trip allows.
function viewWindow({ throwOn } = {}) {
  const page = vm.createContext({ setTimeout, clearTimeout, console });
  vm.runInContext('globalThis.window = globalThis;', page);
  let destroyed = false;
  return {
    isDestroyed: () => destroyed,
    destroy() { destroyed = true; },
    webContents: {
      getURL: () => 'file:///app/dist/views/main/index.html',
      async executeJavaScript(code) {
        if (throwOn && code.includes(throwOn)) throw new Error('Object has been destroyed');
        const result = vm.runInContext(code, page);
        const copy = result === undefined ? undefined : JSON.parse(JSON.stringify(result));
        if (code.includes('__omegaTestQueue.splice') && page.__finish) {
          const finish = page.__finish;
          page.__finish = null;
          finish();
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return copy;
      },
    },
  };
}

// Run view suites one after another as the boot harness does, each in its own window.
async function runViews(specs, { windows, sources = engineSources() }) {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-view-loop-'));
  fs.mkdirSync(path.join(appRoot, 'dist', 'views', 'main'), { recursive: true });
  fs.writeFileSync(path.join(appRoot, 'dist', 'views', 'main', 'index.html'), '<!doctype html>');
  const omega = { windows: { create: async () => windows.shift() } };
  const events = [];
  try {
    for (let i = 0; i < specs.length; i += 1) {
      const suite = serializeSuite(normalizeSpec(specs[i], { file: `boot/view-${i}.test.js` }));
      await runViewSuite(suite, i, omega, { appRoot }, sources, (event) => events.push(event));
    }
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
  return events;
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'the page engine: renderer-entry.js over a serialized suite',
  tests: [
    {
      name: 'case-159 a serialized suite run in a page reports pass, fail with its stack, and skip with its reason, by id',
      run: async (ctx) => {
        const suite = serializeSuite(normalizeSpec(SPEC, { file: FILE }));
        const events = await runPageEngine({ sources: engineSources(), suites: [suite], layer: 'renderer' });

        ctx.expect(events.map((event) => [event.id, event.status])).toEqual([
          [`${FILE}#0`, 'pass'],
          [`${FILE}#1`, 'fail'],
          [`${FILE}#2`, 'skip'],
        ]);
        ctx.expect(events[1].error.name).toBe('AssertionError');
        ctx.expect(events[1].error.message).toBeTypeOf('string');
        ctx.expect(events[1].error.message.length).toBeGreaterThan(0);
        ctx.expect(events[1].error.stack).toBeTypeOf('string');
        ctx.expect(events[2].reason).toBe('not on this page');
      },
    },
    {
      name: 'a view suite whose last event and done land between two polls still reports every case',
      run: async (ctx) => {
        const events = await runViews([GATED_VIEW], { windows: [viewWindow()] });

        ctx.expect(events.map((event) => [event.id, event.status])).toEqual([
          ['boot/view-0.test.js#0', 'pass'],
          ['boot/view-0.test.js#1', 'pass'],
        ]);
      },
    },
    {
      name: 'a view suite that throws fails its own cases with the error, and the next view suite runs',
      run: async (ctx) => {
        const events = await runViews([PLAIN_VIEW, PLAIN_VIEW], {
          windows: [viewWindow({ throwOn: '__omegaTestDeliver(' }), viewWindow()],
        });

        ctx.expect(events.map((event) => [event.id, event.status])).toEqual([
          ['boot/view-0.test.js#0', 'fail'],
          ['boot/view-1.test.js#0', 'pass'],
        ]);
        ctx.expect(events[0].error.message).toContain('Object has been destroyed');
      },
    },
    {
      name: 'a view suite whose page engine ends with an error fails its cases with it',
      run: async (ctx) => {
        const sources = { ...engineSources(), runCase: 'throw new Error("the engine could not load");' };
        const events = await runViews([PLAIN_VIEW], { windows: [viewWindow()], sources });

        ctx.expect(events.map((event) => [event.id, event.status])).toEqual([['boot/view-0.test.js#0', 'fail']]);
        ctx.expect(events[0].error.message).toContain('the engine could not load');
      },
    },
  ],
});

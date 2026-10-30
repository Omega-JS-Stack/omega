// Build-layer tests for the `mgr cdp` toolkit (src/commands/cdp.js + cdp/).
// The IO surface (live CDP endpoint, screencapture, osascript) only exists
// with a running consumer app, so this covers the pure parts: target
// matching, config resolvers, dispatch, and that every module loads cleanly;
// the client's crash handling runs against a stub page socket.

const http = require('http');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const COMMANDS_DIR = path.join(__dirname, '..', '..', '..', 'commands');

// A page target's socket that answers every command but an evaluate, and
// reports the target crashed instead: Chrome's only word for a dead renderer.
class CrashingSocket {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    setImmediate(() => this.fire('open', {}));
  }

  addEventListener(type, listener) {
    (this.listeners[type] = this.listeners[type] || []).push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] || []).filter((each) => each !== listener);
  }

  fire(type, event) {
    if (this[`on${type}`]) this[`on${type}`](event);
    for (const listener of this.listeners[type] || []) listener(event);
  }

  send(data) {
    const { id, method } = JSON.parse(data);
    const reply = method === 'Runtime.evaluate'
      ? { method: 'Inspector.targetCrashed', params: {} }
      : { id, result: {} };
    setImmediate(() => this.fire('message', { data: JSON.stringify(reply) }));
  }

  close() {
    setImmediate(() => this.fire('close', {}));
  }
}

const PAGES = [
  { type: 'page', url: 'file:///x/dist/views/main/index.html' },
  { type: 'page', url: 'app://overlay/' },
  { type: 'page', url: 'https://example.com/' },
  { type: 'other', url: 'app://overlay/' },
];

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'mgr cdp — CLI toolkit pure parts',
  tests: [
    {
      name: 'pickTarget matches page targets by URL substring',
      run: (ctx) => {
        const client = require(path.join(COMMANDS_DIR, 'cdp', 'client.js'));

        ctx.expect(client.pickTarget(PAGES, client.MAIN_VIEW).url).toBe('file:///x/dist/views/main/index.html');
        ctx.expect(client.pickTarget(PAGES, 'app://overlay').url).toBe('app://overlay/');
        ctx.expect(client.pickTarget(PAGES, 'example.com').url).toBe('https://example.com/');
      },
    },
    {
      name: 'pickTarget returns null for no match, empty matcher, and non-page targets',
      run: (ctx) => {
        const client = require(path.join(COMMANDS_DIR, 'cdp', 'client.js'));

        ctx.expect(client.pickTarget(PAGES, 'app://nope')).toBe(null);
        ctx.expect(client.pickTarget(PAGES, '')).toBe(null);
        ctx.expect(client.pickTarget([{ type: 'other', url: 'app://x/' }], 'app://x')).toBe(null);
      },
    },
    {
      name: 'appNames: Electron always; productName appended when configured',
      run: (ctx) => {
        const client = require(path.join(COMMANDS_DIR, 'cdp', 'client.js'));

        ctx.expect(client.appNames({})).toEqual(['Electron']);
        ctx.expect(client.appNames(null)).toEqual(['Electron']);
        ctx.expect(client.appNames({ app: { productName: 'Somiibo' } })).toEqual(['Electron', 'Somiibo']);
      },
    },
    {
      name: 'readyMatcher: main view by default, config cdp.readySignal wins',
      run: (ctx) => {
        const client = require(path.join(COMMANDS_DIR, 'cdp', 'client.js'));

        ctx.expect(client.readyMatcher({})).toBe(client.MAIN_VIEW);
        ctx.expect(client.readyMatcher(null)).toBe(client.MAIN_VIEW);
        ctx.expect(client.readyMatcher({ cdp: { readySignal: 'app://overlay' } })).toBe('app://overlay');
      },
    },
    {
      name: 'dispatcher rejects missing and unknown subcommands',
      run: async (ctx) => {
        const dispatch = require(path.join(COMMANDS_DIR, 'cdp.js'));

        let missing = null;
        await dispatch({ _: ['cdp'] }).catch((error) => { missing = error; });
        ctx.expect(missing && missing.message).toBe('Missing cdp subcommand');

        let unknown = null;
        await dispatch({ _: ['cdp', 'bogus'] }).catch((error) => { unknown = error; });
        ctx.expect(unknown && unknown.message).toBe('Unknown cdp subcommand "bogus"');
      },
    },
    {
      name: 'every subcommand module loads and exports a handler function',
      run: (ctx) => {
        for (const sub of ['status', 'eval', 'shot', 'capture', 'theme', 'relaunch', 'quit']) {
          const handler = require(path.join(COMMANDS_DIR, 'cdp', `${sub}.js`));
          ctx.expect(typeof handler).toBe('function');
        }
        const quit = require(path.join(COMMANDS_DIR, 'cdp', 'quit.js'));
        ctx.expect(typeof quit.quitAndDrain).toBe('function');
      },
    },
    {
      name: 'evaluate rejects as soon as the target crashes, and its command timer is cleared',
      run: async (ctx) => {
        const clientPath = require.resolve(path.join(COMMANDS_DIR, 'cdp', 'client.js'));
        const client = require(clientPath);

        // The DevTools endpoint's target list, on a port the system picks
        const server = http.createServer((request, response) => {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify([{ type: 'page', url: 'file:///x/dist/views/main/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/1' }]));
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

        // Every timer the client itself sets, until it fires or is cleared
        const saved = { port: process.env.OMEGA_CDP_PORT, WebSocket: globalThis.WebSocket, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
        const pending = new Set();
        process.env.OMEGA_CDP_PORT = String(server.address().port);
        globalThis.WebSocket = CrashingSocket;
        globalThis.setTimeout = (fn, ms, ...args) => {
          const handle = saved.setTimeout(() => { pending.delete(handle); fn(...args); }, ms);
          if (new Error().stack.includes(clientPath)) pending.add(handle);
          return handle;
        };
        globalThis.clearTimeout = (handle) => {
          pending.delete(handle);
          saved.clearTimeout(handle);
        };

        let failure = null;
        try {
          await client.evaluate(client.MAIN_VIEW, '1 + 1').catch((error) => { failure = error; });
        } finally {
          globalThis.WebSocket = saved.WebSocket;
          globalThis.setTimeout = saved.setTimeout;
          globalThis.clearTimeout = saved.clearTimeout;
          if (saved.port === undefined) delete process.env.OMEGA_CDP_PORT;
          else process.env.OMEGA_CDP_PORT = saved.port;
          server.closeAllConnections();
          server.close();
        }

        ctx.expect(failure && failure.message).toMatch(/crash/i);
        ctx.expect(pending.size).toBe(0);
      },
    },
  ],
});

const defineCases = require('@omega.js/devkit/test/define-cases');
const { mock } = require('node:test');
const { createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

// live-page is transport-free: the loading line and swap are pure, and the
// poller's only seam is the fetcher it is HANDED — so every test here drives
// the real module with a real (in-memory) fetcher, nothing stubbed of our own.
let loading;
let swap;
let createFeedPoller;

// An omega.request-shaped fetcher: resolves with the body, throws an Error
// carrying `.code` — the exact contract omega.request()/createRequest honour.
function fetcherOf(answers) {
  const calls = [];
  const fetcher = async (path) => {
    calls.push(path);
    const next = answers.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { fetcher, calls };
}

function failure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The tab-visibility seam: `document.hidden` plus the visibilitychange
// listeners the poller arms, swapped onto the shared fake document the same
// way triggers.test.js captures its click handler.
function fakeVisibility() {
  const { addEventListener, removeEventListener, hidden } = global.document;
  const handlers = new Set();

  global.document.hidden = false;
  global.document.addEventListener = (type, handler) => {
    if (type === 'visibilitychange') {
      handlers.add(handler);
    }
  };
  global.document.removeEventListener = (type, handler) => {
    if (type === 'visibilitychange') {
      handlers.delete(handler);
    }
  };

  // What the browser does on a tab change: flip the flag, then tell whoever asked.
  const change = (next) => {
    global.document.hidden = next;
    handlers.forEach((handler) => handler());
  };

  return {
    hide: () => change(true),
    show: () => change(false),
    listeners: () => handlers.size,
    restore: () => {
      global.document.addEventListener = addEventListener;
      global.document.removeEventListener = removeEventListener;
      if (hidden === undefined) {
        delete global.document.hidden;
      } else {
        global.document.hidden = hidden;
      }
    },
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'live-page',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        const mod = await import('../src/modules/live-page.js');
        loading = mod.loading;
        swap = mod.swap;
        createFeedPoller = mod.createFeedPoller;
      })()));

      cases.push(
        {
          name: 'live-page > loading > says which read a section is waiting on',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const markup = loading('reading the board…');
            ctx.expect(markup.includes('spinner-border'), 'the theme spinner').toBeTruthy();
            ctx.expect(markup.includes('reading the board…'), 'and the sentence naming the read').toBeTruthy();
            ctx.expect(markup.includes('aria-live="polite"'), 'announced to a screen reader').toBeTruthy();
          },
        },
        {
          name: 'live-page > loading > escapes what it is handed',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const markup = loading('<img src=x onerror=1>');
            ctx.expect(!markup.includes('<img'), 'a message is text, never markup').toBeTruthy();
            ctx.expect(markup.includes('&lt;img src=x onerror=1&gt;'), 'shown as the text it is').toBeTruthy();
          },
        },
      );

      cases.push(
        {
          name: 'live-page > swap > writes once and leaves an unchanged section alone',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            // A host is only ever asked for `innerHTML`, so a plain object is the
            // real contract — swap compares against what IT wrote, never against the
            // DOM's own re-serialization of it.
            const host = { innerHTML: '' };
            ctx.expect(swap(host, '<p>one</p>'), 'the first write happens').toBe(true);
            ctx.expect(host.innerHTML, 'and lands').toBe('<p>one</p>');
            ctx.expect(swap(host, '<p>one</p>'), 'the same markup is not written again').toBe(false);
            ctx.expect(swap(host, '<p>two</p>'), 'different markup is').toBe(true);
            ctx.expect(host.innerHTML, 'and replaces it').toBe('<p>two</p>');
          },
        },
        {
          name: 'live-page > swap > keeps a separate last write per section',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const $a = { innerHTML: '' };
            const $b = { innerHTML: '' };
            swap($a, '<p>a</p>');
            ctx.expect(swap($b, '<p>a</p>'), 'the same markup in another host is still new').toBe(true);
            ctx.expect(swap($a, '<p>a</p>'), 'and the first host still knows what it holds').toBe(false);
          },
        },
      );

      cases.push(
        {
          name: 'live-page > createFeedPoller > requires a fetcher',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(() => createFeedPoller({ feeds: {} })).toThrow(/requires a fetcher/);
          },
        },
        {
          name: 'live-page > createFeedPoller > refuses a feed the table does not declare',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { fetcher } = fetcherOf([]);
            const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });
            await ctx.expect((() => poller.read('nonsense'))()).rejects.toThrow(/no feed named "nonsense"/);
          },
        },
        {
          name: 'live-page > createFeedPoller > records a good read and stamps it',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { fetcher, calls } = fetcherOf([{ issues: [1, 2] }]);
            const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

            await poller.read('board');

            ctx.expect(calls, 'the declared path').toEqual(['/api/board']);
            ctx.expect(poller.state.feeds.board.ok, 'the read landed').toBe(true);
            ctx.expect(poller.state.feeds.board.data, 'carrying the body').toEqual({ issues: [1, 2] });
            ctx.expect(poller.state.feeds.board.reason, 'with nothing to explain').toBe(null);
            ctx.expect(poller.state.stamp.startsWith('updated '), 'and the page knows when').toBeTruthy();
          },
        },
        {
          name: 'live-page > createFeedPoller > counts a read in flight and lets go of it',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const seen = [];
            const { fetcher } = fetcherOf([{ ok: 1 }]);
            const poller = createFeedPoller({
              feeds: { board: { path: '/api/board', every: 1000 } },
              fetcher,
              onChange: () => seen.push(poller.state.pending),
            });

            await poller.read('board');

            ctx.expect(seen, 'one in flight, then none — the chrome spinner draws off this').toEqual([1, 0]);
          },
        },
        {
          name: 'live-page > createFeedPoller > reports a failed first read with its status and reason',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { fetcher } = fetcherOf([failure('Request failed with status 503', 503)]);
            const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

            await poller.read('board');

            ctx.expect(poller.state.feeds.board.ok, 'it did not answer').toBe(false);
            ctx.expect(poller.state.feeds.board.data, 'with no body').toBe(null);
            ctx.expect(poller.state.feeds.board.status, 'the status off the thrown error').toBe(503);
            ctx.expect(poller.state.feeds.board.reason, 'and the sentence to show').toBe('Request failed with status 503');
            ctx.expect(poller.state.pending, 'a failure releases its in-flight slot too').toBe(0);
          },
        },
        {
          name: 'live-page > createFeedPoller > reports a transport failure that carries no status',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { fetcher } = fetcherOf([new Error('Failed to fetch')]);
            const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

            await poller.read('board');

            ctx.expect(poller.state.feeds.board.status, 'unknown is null, never undefined on the page').toBe(null);
            ctx.expect(poller.state.feeds.board.reason, 'the browser sentence survives').toBe('Failed to fetch');
          },
        },
        {
          name: 'live-page > createFeedPoller > keeps the last good answer when a refresh fails, marked stale',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { fetcher } = fetcherOf([
              { issues: [1] },
              failure('Request failed with status 500', 500),
            ]);
            const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

            await poller.read('board');
            await poller.read('board');

            ctx.expect(poller.state.feeds.board.ok, 'the page still has a board').toBe(true);
            ctx.expect(poller.state.feeds.board.data, 'the one it already had').toEqual({ issues: [1] });
            ctx.expect(poller.state.feeds.board.stale, 'named as stale, with why').toBe('Request failed with status 500');
          },
        },
        {
          name: 'live-page > createFeedPoller > clears the stale mark when the feed answers again',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { fetcher } = fetcherOf([
              { issues: [1] },
              failure('Request failed with status 500', 500),
              { issues: [1, 2] },
            ]);
            const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

            await poller.read('board');
            await poller.read('board');
            await poller.read('board');

            ctx.expect(poller.state.feeds.board.data, 'the fresh answer replaces it').toEqual({ issues: [1, 2] });
            ctx.expect(poller.state.feeds.board.stale, 'and nothing is stale any more').toBe(undefined);
          },
        },
        {
          name: 'live-page > createFeedPoller > does not keep a failure behind a failure — two misses in a row is the failure',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { fetcher } = fetcherOf([
              failure('first miss', 500),
              failure('second miss', 500),
            ]);
            const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

            await poller.read('board');
            await poller.read('board');

            ctx.expect(poller.state.feeds.board.ok, 'still down').toBe(false);
            ctx.expect(poller.state.feeds.board.reason, 'saying the latest reason').toBe('second miss');
            ctx.expect(poller.state.feeds.board.stale, 'a feed that never answered has nothing to hold').toBe(undefined);
          },
        },
        {
          name: 'live-page > createFeedPoller > names every feed that is not telling the truth',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            // readAll reads in declaration order, so the answers are queued that way:
            // pass one is repos-good/board-down, pass two repos-missed/board-back.
            const { fetcher } = fetcherOf([
              { roster: [] },
              failure('board is down', 500),
              failure('refresh missed', 500),
              { issues: [] },
            ]);
            const poller = createFeedPoller({
              feeds: {
                repos: { path: '/api/repos', every: 1000 },
                board: { path: '/api/board', every: 1000 },
              },
              fetcher,
            });

            await poller.readAll(false);
            ctx.expect(poller.staleFeeds(), 'the outright failure').toEqual([{ name: 'board', reason: 'board is down' }]);

            await poller.readAll(false);
            ctx.expect(poller.staleFeeds(), 'and a last-good answer behind a failed refresh, with the refresh reason').toEqual([{ name: 'repos', reason: 'refresh missed' }]);
          },
        },
        {
          name: 'live-page > createFeedPoller > reads every declared feed on readAll',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { fetcher, calls } = fetcherOf([{ a: 1 }, { b: 2 }]);
            const poller = createFeedPoller({
              feeds: {
                repos: { path: '/api/repos', every: 1000 },
                board: { path: '/api/board', every: 1000 },
              },
              fetcher,
            });

            await poller.readAll(false);

            ctx.expect(calls.sort(), 'both paths').toEqual(['/api/board', '/api/repos']);
            ctx.expect(Object.keys(poller.state.feeds).length, 'both results').toBe(2);
          },
        },
        {
          name: 'live-page > createFeedPoller > uses the fresh path only when a refresh asks and the feed offers one',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { fetcher, calls } = fetcherOf([{}, {}, {}]);
            const poller = createFeedPoller({
              feeds: {
                board: { path: '/api/board', every: 1000, fresh: '/api/board?fresh=1' },
                brief: { path: '/api/brief', every: 1000 },
              },
              fetcher,
            });

            await poller.read('board', false);
            await poller.read('board', true);
            await poller.read('brief', true);

            ctx.expect(calls, 'a poll is the plain path, a refresh takes the bypass, and a feed without one keeps its path').toEqual(['/api/board', '/api/board?fresh=1', '/api/brief']);
          },
        },
        {
          name: 'live-page > createFeedPoller > polls each feed on its own cadence until it is stopped',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            // The cadence IS what this case pins, so the clock is the runner's, not
            // the wall's: a real sleep only delivers as many ticks as a loaded
            // machine felt like giving, which is what made this the flaky one (#419).
            // Only setInterval is faked — the awaits below still need real
            // timers/microtasks to drain each read.
            mock.timers.enable({ apis: ['setInterval'] });
            ctx.after(() => mock.timers.reset());

            const answers = [];
            const fetcher = async (path) => { answers.push(path); return {}; };
            const countOf = (path) => answers.filter((asked) => asked === path).length;
            const poller = createFeedPoller({
              feeds: {
                fast: { path: '/fast', every: 20 },
                slow: { path: '/slow', every: 200 },
              },
              fetcher,
            });

            await poller.start();
            ctx.expect(answers.slice().sort(), 'the first pass reads both once').toEqual(['/fast', '/slow']);

            await poller.start();
            ctx.expect(answers.length, 'starting twice does not read twice').toBe(2);

            // 100ms on the poller's clock: five fast cadences, and the slow feed's
            // has not come round even once
            mock.timers.tick(100);
            ctx.expect(countOf('/fast'), 'the fast feed re-read on every one of its own cadences').toBe(6);
            ctx.expect(countOf('/slow'), 'while the slow one has not come round yet').toBe(1);

            // 200ms in, the slow feed reads — once, on ITS cadence
            mock.timers.tick(100);
            ctx.expect(countOf('/slow'), 'the slow feed reads when its own cadence lands').toBe(2);
            ctx.expect(countOf('/fast'), 'and the fast one kept its own, unchanged').toBe(11);

            poller.stop();
            const after = answers.length;
            mock.timers.tick(10000);
            ctx.expect(answers.length, 'and a stopped poller reads nothing more').toBe(after);
          },
        },
        {
          name: 'live-page > createFeedPoller > pauses its cadence in a hidden tab and resumes with one immediate read',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            // Same faked clock as the cadence case above: what is pinned here is
            // WHICH ticks land, so the ticks are the poller's, not the wall's.
            mock.timers.enable({ apis: ['setInterval'] });
            ctx.after(() => mock.timers.reset());
            const visibility = fakeVisibility();

            const answers = [];
            const fetcher = async (path) => { answers.push(path); return {}; };
            const poller = createFeedPoller({ feeds: { board: { path: '/board', every: 20 } }, fetcher });

            await poller.start();
            ctx.expect(answers.length, 'the first pass reads once').toBe(1);

            mock.timers.tick(40);
            ctx.expect(answers.length, 'and a visible tab keeps its cadence').toBe(3);

            visibility.hide();
            const covered = answers.length;
            mock.timers.tick(2000);
            ctx.expect(answers.length, 'a covered tab reads nothing, however long it stays covered').toBe(covered);

            visibility.show();
            ctx.expect(answers.length, 'coming back reads ONCE, immediately').toBe(covered + 1);

            mock.timers.tick(40);
            ctx.expect(answers.length, 'and the cadence runs again from there').toBe(covered + 3);

            poller.stop();
            visibility.restore();
          },
        },
        {
          name: 'live-page > createFeedPoller > lets go of the visibility listener when it stops',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            // The runner's clock again, so a failed assertion below cannot leave a
            // live interval holding the whole file open.
            mock.timers.enable({ apis: ['setInterval'] });
            ctx.after(() => mock.timers.reset());
            const visibility = fakeVisibility();
            const fetcher = async () => ({});
            const poller = createFeedPoller({ feeds: { board: { path: '/board', every: 20 } }, fetcher });

            await poller.start();
            ctx.expect(visibility.listeners(), 'a running poller watches the tab').toBe(1);

            poller.stop();
            ctx.expect(visibility.listeners(), 'and a stopped one leaves nothing listening').toBe(0);

            visibility.restore();
          },
        },
        {
          name: 'live-page > createFeedPoller > a stop() during the first pass keeps the timers from ever arming',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const answers = [];
            let release;
            const gate = new Promise((resolve) => { release = resolve; });
            const fetcher = async (path) => { answers.push(path); await gate; return {}; };
            const poller = createFeedPoller({
              feeds: { only: { path: '/only', every: 10 } },
              fetcher,
            });

            const starting = poller.start();
            poller.stop();
            release();
            await starting;

            const after = answers.length;
            await sleep(60);
            ctx.expect(answers.length, 'no interval fires after a stop that beat the first pass').toBe(after);
          },
        },
      );
      return cases;
    })(),
  ],
});

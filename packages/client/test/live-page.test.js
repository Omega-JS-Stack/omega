const { describe, it, before } = require('node:test');
const { assert } = require('./helpers.js');

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

describe('live-page', () => {

  before(async () => {
    const mod = await import('../src/modules/live-page.js');
    loading = mod.loading;
    swap = mod.swap;
    createFeedPoller = mod.createFeedPoller;
  });

  describe('loading', () => {

    it('says which read a section is waiting on', () => {
      const markup = loading('reading the board…');
      assert.ok(markup.includes('spinner-border'), 'the theme spinner');
      assert.ok(markup.includes('reading the board…'), 'and the sentence naming the read');
      assert.ok(markup.includes('aria-live="polite"'), 'announced to a screen reader');
    });

    it('escapes what it is handed', () => {
      const markup = loading('<img src=x onerror=1>');
      assert.ok(!markup.includes('<img'), 'a message is text, never markup');
      assert.ok(markup.includes('&lt;img src=x onerror=1&gt;'), 'shown as the text it is');
    });

  });

  describe('swap', () => {

    it('writes once and leaves an unchanged section alone', () => {
      // A host is only ever asked for `innerHTML`, so a plain object is the
      // real contract — swap compares against what IT wrote, never against the
      // DOM's own re-serialization of it.
      const host = { innerHTML: '' };
      assert.strictEqual(swap(host, '<p>one</p>'), true, 'the first write happens');
      assert.strictEqual(host.innerHTML, '<p>one</p>', 'and lands');
      assert.strictEqual(swap(host, '<p>one</p>'), false, 'the same markup is not written again');
      assert.strictEqual(swap(host, '<p>two</p>'), true, 'different markup is');
      assert.strictEqual(host.innerHTML, '<p>two</p>', 'and replaces it');
    });

    it('keeps a separate last write per section', () => {
      const $a = { innerHTML: '' };
      const $b = { innerHTML: '' };
      swap($a, '<p>a</p>');
      assert.strictEqual(swap($b, '<p>a</p>'), true, 'the same markup in another host is still new');
      assert.strictEqual(swap($a, '<p>a</p>'), false, 'and the first host still knows what it holds');
    });

  });

  describe('createFeedPoller', () => {

    it('requires a fetcher', () => {
      assert.throws(() => createFeedPoller({ feeds: {} }), /requires a fetcher/);
    });

    it('refuses a feed the table does not declare', async () => {
      const { fetcher } = fetcherOf([]);
      const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });
      await assert.rejects(() => poller.read('nonsense'), /no feed named "nonsense"/);
    });

    it('records a good read and stamps it', async () => {
      const { fetcher, calls } = fetcherOf([{ issues: [1, 2] }]);
      const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

      await poller.read('board');

      assert.deepStrictEqual(calls, ['/api/board'], 'the declared path');
      assert.strictEqual(poller.state.feeds.board.ok, true, 'the read landed');
      assert.deepStrictEqual(poller.state.feeds.board.data, { issues: [1, 2] }, 'carrying the body');
      assert.strictEqual(poller.state.feeds.board.reason, null, 'with nothing to explain');
      assert.ok(poller.state.stamp.startsWith('updated '), 'and the page knows when');
    });

    it('counts a read in flight and lets go of it', async () => {
      const seen = [];
      const { fetcher } = fetcherOf([{ ok: 1 }]);
      const poller = createFeedPoller({
        feeds: { board: { path: '/api/board', every: 1000 } },
        fetcher,
        onChange: () => seen.push(poller.state.pending),
      });

      await poller.read('board');

      assert.deepStrictEqual(seen, [1, 0], 'one in flight, then none — the chrome spinner draws off this');
    });

    it('reports a failed first read with its status and reason', async () => {
      const { fetcher } = fetcherOf([failure('Request failed with status 503', 503)]);
      const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

      await poller.read('board');

      assert.strictEqual(poller.state.feeds.board.ok, false, 'it did not answer');
      assert.strictEqual(poller.state.feeds.board.data, null, 'with no body');
      assert.strictEqual(poller.state.feeds.board.status, 503, 'the status off the thrown error');
      assert.strictEqual(poller.state.feeds.board.reason, 'Request failed with status 503', 'and the sentence to show');
      assert.strictEqual(poller.state.pending, 0, 'a failure releases its in-flight slot too');
    });

    it('reports a transport failure that carries no status', async () => {
      const { fetcher } = fetcherOf([new Error('Failed to fetch')]);
      const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

      await poller.read('board');

      assert.strictEqual(poller.state.feeds.board.status, null, 'unknown is null, never undefined on the page');
      assert.strictEqual(poller.state.feeds.board.reason, 'Failed to fetch', 'the browser sentence survives');
    });

    it('keeps the last good answer when a refresh fails, marked stale', async () => {
      const { fetcher } = fetcherOf([
        { issues: [1] },
        failure('Request failed with status 500', 500),
      ]);
      const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

      await poller.read('board');
      await poller.read('board');

      assert.strictEqual(poller.state.feeds.board.ok, true, 'the page still has a board');
      assert.deepStrictEqual(poller.state.feeds.board.data, { issues: [1] }, 'the one it already had');
      assert.strictEqual(poller.state.feeds.board.stale, 'Request failed with status 500', 'named as stale, with why');
    });

    it('clears the stale mark when the feed answers again', async () => {
      const { fetcher } = fetcherOf([
        { issues: [1] },
        failure('Request failed with status 500', 500),
        { issues: [1, 2] },
      ]);
      const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

      await poller.read('board');
      await poller.read('board');
      await poller.read('board');

      assert.deepStrictEqual(poller.state.feeds.board.data, { issues: [1, 2] }, 'the fresh answer replaces it');
      assert.strictEqual(poller.state.feeds.board.stale, undefined, 'and nothing is stale any more');
    });

    it('does not keep a failure behind a failure — two misses in a row is the failure', async () => {
      const { fetcher } = fetcherOf([
        failure('first miss', 500),
        failure('second miss', 500),
      ]);
      const poller = createFeedPoller({ feeds: { board: { path: '/api/board', every: 1000 } }, fetcher });

      await poller.read('board');
      await poller.read('board');

      assert.strictEqual(poller.state.feeds.board.ok, false, 'still down');
      assert.strictEqual(poller.state.feeds.board.reason, 'second miss', 'saying the latest reason');
      assert.strictEqual(poller.state.feeds.board.stale, undefined, 'a feed that never answered has nothing to hold');
    });

    it('names every feed that is not telling the truth', async () => {
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
      assert.deepStrictEqual(poller.staleFeeds(), [{ name: 'board', reason: 'board is down' }], 'the outright failure');

      await poller.readAll(false);
      assert.deepStrictEqual(
        poller.staleFeeds(),
        [{ name: 'repos', reason: 'refresh missed' }],
        'and a last-good answer behind a failed refresh, with the refresh reason',
      );
    });

    it('reads every declared feed on readAll', async () => {
      const { fetcher, calls } = fetcherOf([{ a: 1 }, { b: 2 }]);
      const poller = createFeedPoller({
        feeds: {
          repos: { path: '/api/repos', every: 1000 },
          board: { path: '/api/board', every: 1000 },
        },
        fetcher,
      });

      await poller.readAll(false);

      assert.deepStrictEqual(calls.sort(), ['/api/board', '/api/repos'], 'both paths');
      assert.strictEqual(Object.keys(poller.state.feeds).length, 2, 'both results');
    });

    it('uses the fresh path only when a refresh asks and the feed offers one', async () => {
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

      assert.deepStrictEqual(
        calls,
        ['/api/board', '/api/board?fresh=1', '/api/brief'],
        'a poll is the plain path, a refresh takes the bypass, and a feed without one keeps its path',
      );
    });

    it('polls each feed on its own cadence until it is stopped', async () => {
      const answers = [];
      const fetcher = async (path) => { answers.push(path); return {}; };
      const poller = createFeedPoller({
        feeds: {
          fast: { path: '/fast', every: 20 },
          slow: { path: '/slow', every: 200 },
        },
        fetcher,
      });

      await poller.start();
      assert.deepStrictEqual(answers.slice().sort(), ['/fast', '/slow'], 'the first pass reads both once');

      await poller.start();
      assert.strictEqual(answers.length, 2, 'starting twice does not read twice');

      await sleep(90);
      poller.stop();
      const fast = answers.filter((path) => path === '/fast').length;
      const slow = answers.filter((path) => path === '/slow').length;
      assert.ok(fast >= 3, `the fast feed re-read on its cadence (saw ${fast})`);
      assert.strictEqual(slow, 1, 'while the slow one has not come round yet');

      const after = answers.length;
      await sleep(60);
      assert.strictEqual(answers.length, after, 'and a stopped poller reads nothing more');
    });

    it('a stop() during the first pass keeps the timers from ever arming', async () => {
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
      assert.strictEqual(answers.length, after, 'no interval fires after a stop that beat the first pass');
    });

  });

});

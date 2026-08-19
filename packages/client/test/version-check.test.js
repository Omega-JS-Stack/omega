const { describe, it, afterEach } = require('node:test');
const { getManager, TEST_CONFIG, assert, setPathPrefix } = require('./helpers.js');

// Minimal fetch stand-in: the transport boundary is the only seam, and the
// poll's manifest is the one thing it asks for. Records every request URL.
function fetchStub() {
  const calls = [];

  global.fetch = async (url) => {
    calls.push(url);

    return {
      ok: true,
      status: 200,
      // A build older than this page's own — the poll reads it and stays put,
      // so nothing here reaches the reload branch.
      json: async () => ({ timestamp: Date.now() - (1000 * 60 * 60 * 24) }),
    };
  };

  return calls;
}

// #364 — the refresh-new-version poll fetches the build manifest the web build
// emits, which is served from the site's mount. Root-relative, it 404s forever
// on a site served under a URL path (#355).
describe('Version check under a URL-path mount', () => {
  let restorePrefix;

  afterEach(() => {
    delete global.fetch;
    restorePrefix?.();
    restorePrefix = null;
  });

  it('should poll the mounted manifest under a path prefix', async () => {
    restorePrefix = setPathPrefix('/workkit');
    const calls = fetchStub();

    const manager = getManager();
    await manager.initialize({ ...TEST_CONFIG });
    await manager._checkVersion();

    assert.strictEqual(calls.length, 1);
    assert.match(calls[0], /^\/workkit\/build\.json\?cb=\d+$/);
  });

  it('should leave the unprefixed poll byte-identical', async () => {
    const calls = fetchStub();

    const manager = getManager();
    await manager.initialize({ ...TEST_CONFIG });
    await manager._checkVersion();

    assert.strictEqual(calls.length, 1);
    assert.match(calls[0], /^\/build\.json\?cb=\d+$/);
  });
});

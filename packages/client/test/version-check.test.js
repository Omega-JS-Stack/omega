const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, setPathPrefix, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

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

module.exports = defineCases({
  type: 'group',
  description: 'version-check',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    // #364 — the refresh-new-version poll fetches the build manifest the web build
    // emits, which is served from the site's mount. Root-relative, it 404s forever
    // on a site served under a URL path (#355).
    ...(() => {
      const cases = [];
      let restorePrefix;

      const afterEachHook = () => {
        delete global.fetch;
        restorePrefix?.();
        restorePrefix = null;
      };

      cases.push({
        name: 'Version check under a URL-path mount > should poll the mounted manifest under a path prefix',
        run: async (ctx) => {
          await beforeEachHook();
          ctx.after(afterEachHook);
          restorePrefix = setPathPrefix('/workkit');
          const calls = fetchStub();

          const omega = getOmega();
          await omega.initialize({ ...TEST_CONFIG });
          await omega._checkVersion();

          ctx.expect(calls.length).toBe(1);
          ctx.expect(calls[0]).toMatch(/^\/workkit\/build\.json\?cb=\d+$/);
        },
      });

      cases.push({
        name: 'Version check under a URL-path mount > should leave the unprefixed poll byte-identical',
        run: async (ctx) => {
          await beforeEachHook();
          ctx.after(afterEachHook);
          const calls = fetchStub();

          const omega = getOmega();
          await omega.initialize({ ...TEST_CONFIG });
          await omega._checkVersion();

          ctx.expect(calls.length).toBe(1);
          ctx.expect(calls[0]).toMatch(/^\/build\.json\?cb=\d+$/);
        },
      });
      return cases;
    })(),
  ],
});

const { describe, it, afterEach } = require('node:test');
const { getManager, TEST_CONFIG, assert, setPathPrefix } = require('./helpers.js');

// Count the calls the real ServiceWorker module makes into the harness's inert
// navigator.serviceWorker container — the assertions watch the actual code path.
function instrumentContainer() {
  const container = navigator.serviceWorker;
  const original = {
    register: container.register,
    getRegistrations: container.getRegistrations,
  };
  const calls = { register: 0, getRegistrations: 0 };
  const registered = [];

  container.register = async (...args) => {
    calls.register++;
    registered.push({ url: args[0], options: args[1] });
    return original.register(...args);
  };
  container.getRegistrations = async (...args) => {
    calls.getRegistrations++;
    return original.getRegistrations(...args);
  };

  return {
    calls,
    registered,
    restore() {
      Object.assign(container, original);
    },
  };
}

// Swap the page origin: desktop windows load file:// and extension pages load
// chrome-extension://, both of which ship the API but cannot host a worker.
function setLocation(protocol, href, origin) {
  const previous = { ...global.window.location };

  Object.assign(global.window.location, { protocol, href, origin });

  return () => Object.assign(global.window.location, previous);
}

describe('Service Worker origin gate', () => {
  let container;
  let restoreLocation;

  afterEach(() => {
    container?.restore();
    restoreLocation?.();
    container = null;
    restoreLocation = null;
  });

  it('should skip registration entirely on a file:// origin', async () => {
    restoreLocation = setLocation('file:', 'file:///Applications/Brand.app/index.html', 'file://');
    container = instrumentContainer();

    await getManager().initialize({ ...TEST_CONFIG });

    assert.strictEqual(container.calls.register, 0);
    assert.strictEqual(container.calls.getRegistrations, 0);
  });

  it('should skip the disabled-branch sweep on a chrome-extension:// origin', async () => {
    restoreLocation = setLocation('chrome-extension:', 'chrome-extension://abc/popup.html', 'chrome-extension://abc');
    container = instrumentContainer();

    await getManager().initialize({ ...TEST_CONFIG, serviceWorker: { enabled: false } });

    assert.strictEqual(container.calls.register, 0);
    assert.strictEqual(container.calls.getRegistrations, 0);
  });

  it('should register on an http(s) origin when enabled', async () => {
    container = instrumentContainer();

    await getManager().initialize({ ...TEST_CONFIG });

    assert.strictEqual(container.calls.register, 1);
    assert.strictEqual(container.calls.getRegistrations, 0);
  });

  it('should sweep the origin on an http(s) origin when disabled', async () => {
    container = instrumentContainer();

    await getManager().initialize({ ...TEST_CONFIG, serviceWorker: { enabled: false } });

    assert.strictEqual(container.calls.register, 0);
    assert.strictEqual(container.calls.getRegistrations, 1);
  });
});

// #360 — a site served under a URL path (#355) hosts its worker script at
// /<prefix>/service-worker.js, which can only claim /<prefix>/. The page reads
// the stamp the build wrote on <html> and hands the value to the worker on the
// script URL's query string (a worker has no document to read it from).
describe('Service Worker under a URL-path mount', () => {
  let container;
  let restorePrefix;

  afterEach(() => {
    container?.restore();
    restorePrefix?.();
    container = null;
    restorePrefix = null;
  });

  it('should register the mounted script at the mounted scope, carrying the prefix', async () => {
    restorePrefix = setPathPrefix('/workkit');
    container = instrumentContainer();

    await getManager().initialize({ ...TEST_CONFIG });

    assert.deepStrictEqual(container.registered, [{
      url: '/workkit/service-worker.js?omega-path-prefix=%2Fworkkit',
      options: { scope: '/workkit/', updateViaCache: 'none' },
    }]);
  });

  it('should mount an explicitly configured script path too', async () => {
    restorePrefix = setPathPrefix('/workkit');
    container = instrumentContainer();

    await getManager().initialize({
      ...TEST_CONFIG,
      serviceWorker: { enabled: true, config: { path: '/sw.js' } },
    });

    assert.strictEqual(container.registered[0].url, '/workkit/sw.js?omega-path-prefix=%2Fworkkit');
    assert.strictEqual(container.registered[0].options.scope, '/workkit/');
  });

  it('should leave the unprefixed default byte-identical', async () => {
    container = instrumentContainer();

    await getManager().initialize({ ...TEST_CONFIG });

    assert.deepStrictEqual(container.registered, [{
      url: '/service-worker.js',
      options: { scope: '/', updateViaCache: 'none' },
    }]);
  });
});

const { describe, it, afterEach } = require('node:test');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

// Count the calls the real ServiceWorker module makes into the harness's inert
// navigator.serviceWorker container — the assertions watch the actual code path.
function instrumentContainer() {
  const container = navigator.serviceWorker;
  const original = {
    register: container.register,
    getRegistrations: container.getRegistrations,
  };
  const calls = { register: 0, getRegistrations: 0 };

  container.register = async (...args) => {
    calls.register++;
    return original.register(...args);
  };
  container.getRegistrations = async (...args) => {
    calls.getRegistrations++;
    return original.getRegistrations(...args);
  };

  return {
    calls,
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

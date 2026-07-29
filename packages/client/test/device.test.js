const { describe, it, before, beforeEach, afterEach } = require('node:test');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

describe('Device Module', () => {

  before(async () => {
    await getManager().initialize(TEST_CONFIG);
  });

  it('should expose expected methods', () => {
    const device = getManager().device();
    assert(typeof device.getUsageDuration === 'function');
    assert(typeof device.getSessionDuration === 'function');
    assert(typeof device.getInstalledDate === 'function');
    assert(typeof device.getSessionCount === 'function');
    assert(typeof device.getBindingData === 'function');
    assert(typeof device.reset === 'function');
  });

  it('should return positive usage duration', () => {
    const ms = getManager().device().getUsageDuration('milliseconds');
    assert(ms >= 0);
  });

  it('should return duration in different units', () => {
    const ms = getManager().device().getUsageDuration('milliseconds');
    const sec = getManager().device().getUsageDuration('seconds');
    assert(ms >= sec);
  });

  it('should return session count >= 1', () => {
    assert(getManager().device().getSessionCount() >= 1);
  });

  it('should return installed date as Date object', () => {
    const date = getManager().device().getInstalledDate();
    assert(date instanceof Date);
  });

  it('should return binding data with expected structure', () => {
    const data = getManager().device().getBindingData();
    assert(typeof data.installed === 'number');
    assert(typeof data.session.count === 'number');
    assert(typeof data.duration.total.seconds === 'number');
    assert(typeof data.duration.session.seconds === 'number');
    assert(typeof data.version.isNew === 'boolean');
  });

  it('should reset usage data', async () => {
    const device = getManager().device();
    await device.reset();
    assert.strictEqual(device.getSessionCount(), 1);
    assert.strictEqual(device.isNewVersion, false);
  });
});

describe('Device Module — malformed stored data (wave-4 F6)', () => {
  let priorLocalStorage;

  before(async () => {
    await getManager().initialize(TEST_CONFIG);
  });

  // Earlier suite files remove/replace global.localStorage — install a
  // known-good one for this test (device.js reads the bare identifier)
  // and restore whatever was there afterwards.
  beforeEach(() => {
    priorLocalStorage = global.localStorage;
    const store = {};
    global.localStorage = {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach((key) => delete store[key]); },
    };
  });

  afterEach(() => {
    global.localStorage = priorLocalStorage;
  });

  it('should survive a stored entry missing the session branch', async () => {
    // Raw JSON.parse output is unvalidated external state — an entry with a
    // stale lastActive and NO session key must not break initialize().
    global.localStorage.setItem('omega_device', JSON.stringify({
      installed: 1,
      lastActive: 1,
    }));

    const DeviceModule = (await import('../src/modules/device.js')).default;
    const device = new DeviceModule(getManager());
    const data = await device.initialize();

    // installed: 1 proves the stored entry was actually read (a fresh
    // first-time payload would stamp installed with the current time)
    assert.strictEqual(data.installed, 1);
    assert.strictEqual(data.session.count, 1);
    assert(typeof data.session.started === 'number');
  });
});

describe('Device Module — primitive stored data (wave-4 B3)', () => {

  let priorLocalStorage;

  before(async () => {
    await getManager().initialize(TEST_CONFIG);
  });

  beforeEach(() => {
    priorLocalStorage = global.localStorage;
    const store = {};
    global.localStorage = {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach((key) => delete store[key]); },
    };
  });

  afterEach(() => {
    global.localStorage = priorLocalStorage;
  });

  it('should treat a stored primitive as first-time data, not break boot', async () => {
    global.localStorage.setItem('omega_device', JSON.stringify(5));

    const DeviceModule = (await import('../src/modules/device.js')).default;
    const device = new DeviceModule(getManager());
    const data = await device.initialize();

    assert.strictEqual(data.session.count, 1);
    assert(typeof data.installed === 'number');
  });
});

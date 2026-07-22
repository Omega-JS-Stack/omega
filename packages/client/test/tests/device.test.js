const { getManager, TEST_CONFIG, assert } = require('../helpers.js');

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

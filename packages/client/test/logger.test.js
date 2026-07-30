/**
 * logger tests — the client's runtime tag shape ([#12]): every module logs
 * `[@omega.js/client:<module>] message` with NO timestamp (devtools stamps
 * runtime lines; only the build-time devkit logger prefixes [HH:MM:SS]).
 */
const { describe, it, before, beforeEach, afterEach } = require('node:test');
const { assert } = require('./helpers.js');

describe('Logger Module', () => {
  let createLogger;

  before(async () => {
    ({ createLogger } = await import('../src/modules/logger.js'));
  });

  // Capture one console[method] call; returns its raw args.
  const captured = {};
  const originals = {};
  beforeEach(() => {
    ['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
      originals[method] = console[method];
      console[method] = (...args) => { captured[method] = args; };
    });
  });
  afterEach(() => {
    Object.keys(originals).forEach((method) => { console[method] = originals[method]; });
  });

  it('prefixes exactly [@omega.js/client:<module>] with no timestamp', () => {
    createLogger('push').log('Subscribed');
    assert.strictEqual(captured.log[0], '[@omega.js/client:push]');
    assert.strictEqual(captured.log[1], 'Subscribed');
  });

  it('carries sub-module segments verbatim', () => {
    createLogger('push:sync').log('Synced');
    assert.strictEqual(captured.log[0], '[@omega.js/client:push:sync]');
  });

  it('exposes log/info/warn/error/debug, each routed to its own console method', () => {
    const logger = createLogger('verts');
    ['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
      logger[method]('m', { a: 1 });
      assert.strictEqual(captured[method][0], '[@omega.js/client:verts]');
      assert.strictEqual(captured[method][1], 'm');
      assert.deepStrictEqual(captured[method][2], { a: 1 });
    });
  });

  it('exposes the tag itself', () => {
    assert.strictEqual(createLogger('device').tag, '[@omega.js/client:device]');
  });
});

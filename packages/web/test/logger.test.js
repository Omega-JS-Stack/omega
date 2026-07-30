/**
 * The web runtime's log tag (`core/js/libs/logger.js`) — every browser-side
 * line prints `[@omega.js/web:<module>] message` with NO timestamp (devtools
 * stamps runtime lines; only the build-time devkit logger prefixes
 * [HH:MM:SS]). Mirrors @omega.js/client's `createLogger` API on purpose, but
 * with web's own package segment ([#12]).
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { createLogger } = require('../core/js/libs/logger.js');

// Capture one console[method] call; returns its raw args.
function capture(method, fn) {
  const original = console[method];
  let captured = null;
  console[method] = (...args) => { captured = args; };
  try {
    fn();
  } finally {
    console[method] = original;
  }
  return captured;
}

test('logger: prefixes exactly [@omega.js/web:<module>] with no timestamp', () => {
  const args = capture('log', () => createLogger('auth').log('policy:', { required: true }));
  assert.strictEqual(args[0], '[@omega.js/web:auth]');
  assert.strictEqual(args[1], 'policy:');
  assert.deepStrictEqual(args[2], { required: true });
});

test('logger: sub-module segments ride verbatim', () => {
  const args = capture('warn', () => createLogger('account:security').warn('no user'));
  assert.strictEqual(args[0], '[@omega.js/web:account:security]');
});

test('logger: log/info/warn/error/debug each route to their own console method', () => {
  const logger = createLogger('redirect');
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const args = capture(method, () => logger[method]('m'));
    assert.strictEqual(args[0], '[@omega.js/web:redirect]', `${method} carries the tag`);
    assert.strictEqual(args[1], 'm');
  }
});

test('logger: exposes the tag itself (console.group and %c lines embed it)', () => {
  assert.strictEqual(createLogger('checkout').tag, '[@omega.js/web:checkout]');
});

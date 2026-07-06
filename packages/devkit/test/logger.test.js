// Unit tests for src/logger.js — timestamped, name-scoped console logger.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const chalk = require('chalk').default;
const Logger = require('../src/logger');
const { stripAnsi } = require('../src/attach-log-file');

// Capture a single console[method] call made by fn; returns the stripped, joined args.
function captureConsole(method, fn) {
  const original = console[method];
  let captured = null;
  console[method] = function () {
    captured = Array.from(arguments);
  };
  try {
    fn();
  } finally {
    console[method] = original;
  }
  return captured.map((arg) => stripAnsi(String(arg))).join(' ');
}

test('exposes log/error/warn/info methods and chalk as .format', () => {
  const logger = new Logger('unit');
  ['log', 'error', 'warn', 'info'].forEach((method) => {
    assert.equal(typeof logger[method], 'function');
  });
  assert.equal(logger.format, chalk);
});

test('log() prints [HH:MM:SS] \'name\': message via console.log', () => {
  const logger = new Logger('my-scope');
  const line = captureConsole('log', () => logger.log('hello there'));
  assert.match(line, /^\[\d{2}:\d{2}:\d{2}\] 'my-scope':/);
  assert.match(line, /hello there/);
});

test('error() renders Error instances as their stack', () => {
  const logger = new Logger('boom-scope');
  const line = captureConsole('error', () => logger.error(new Error('boom')));
  assert.match(line, /Error: boom/);
  assert.match(line, /at /); // stack frames present
});

test('non-string, non-Error args pass through untouched', () => {
  const logger = new Logger('obj-scope');
  const payload = { a: 1 };
  const original = console.log;
  let captured = null;
  console.log = function () {
    captured = Array.from(arguments);
  };
  try {
    logger.log(payload, 42);
  } finally {
    console.log = original;
  }
  assert.equal(captured[1], payload);
  assert.equal(captured[2], 42);
});

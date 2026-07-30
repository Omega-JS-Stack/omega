// Unit tests for src/logger.js — timestamped, tag-scoped console logger.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
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

test('log() prints [HH:MM:SS] [@omega.js/<package>:name] message via console.log', () => {
  const logger = new Logger('my-scope');
  const line = captureConsole('log', () => logger.log('hello there'));
  // Constructed from this file, so the package segment is devkit's own name.
  assert.match(line, /^\[\d{2}:\d{2}:\d{2}\] \[@omega\.js\/devkit:my-scope\] /);
  assert.match(line, /hello there/);
});

test('the package segment comes from the CONSTRUCTING file\'s nearest package.json', () => {
  const root = path.join(__dirname, '..', '.temp', `logger-${process.pid}`);
  const dir = jetpack.dir(path.join(root, 'nested', 'deep')).cwd();
  jetpack.write(path.join(root, 'package.json'), { name: '@omega.js/pretend' });
  jetpack.write(path.join(dir, 'construct.js'), [
    `const Logger = require(${JSON.stringify(require.resolve('../src/logger'))});`,
    "module.exports = () => new Logger('watcher');",
  ].join('\n'));

  const logger = require(path.join(dir, 'construct.js'))();
  const line = captureConsole('log', () => logger.log('from a pretend package'));
  assert.match(line, /^\[\d{2}:\d{2}:\d{2}\] \[@omega\.js\/pretend:watcher\] /);

  jetpack.remove(root);
});

test('derivation failure falls back to the devkit package segment', () => {
  // No usable stack → no constructing file to walk up from.
  const originalCapture = Error.captureStackTrace;
  const originalLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  Error.captureStackTrace = () => {};
  let logger;
  try {
    logger = new Logger('orphan');
  } finally {
    Error.captureStackTrace = originalCapture;
    Error.stackTraceLimit = originalLimit;
  }
  const line = captureConsole('log', () => logger.log('still logs'));
  assert.match(line, /^\[\d{2}:\d{2}:\d{2}\] \[@omega\.js\/devkit:orphan\] /);
  assert.match(line, /still logs/);
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

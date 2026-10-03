// Unit tests for src/logger.js — timestamped, tag-scoped console logger.

const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'logger',
  tests: [
    {
      name: 'exposes log/error/warn/info methods and chalk as .format',
      run: (ctx) => {
        const logger = new Logger('unit');
        ['log', 'error', 'warn', 'info'].forEach((method) => {
          ctx.expect(typeof logger[method]).toBe('function');
        });
        ctx.expect(logger.format).toBe(chalk);
      },
    },

    {
      name: 'log() prints [HH:MM:SS] [@omega.js/<package>:name] message via console.log',
      run: (ctx) => {
        const logger = new Logger('my-scope');
        const line = captureConsole('log', () => logger.log('hello there'));
        // Constructed from this file, so the package segment is devkit's own name.
        ctx.expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[@omega\.js\/devkit:my-scope\] /);
        ctx.expect(line).toMatch(/hello there/);
      },
    },

    {
      name: 'the package segment comes from the CONSTRUCTING file\'s nearest package.json',
      run: (ctx) => {
        const root = path.join(__dirname, '..', '.temp', `logger-${process.pid}`);
        const dir = jetpack.dir(path.join(root, 'nested', 'deep')).cwd();
        jetpack.write(path.join(root, 'package.json'), { name: '@omega.js/pretend' });
        jetpack.write(path.join(dir, 'construct.js'), [
          `const Logger = require(${JSON.stringify(require.resolve('../src/logger'))});`,
          "module.exports = () => new Logger('watcher');",
        ].join('\n'));

        const logger = require(path.join(dir, 'construct.js'))();
        const line = captureConsole('log', () => logger.log('from a pretend package'));
        ctx.expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[@omega\.js\/pretend:watcher\] /);

        jetpack.remove(root);
      },
    },

    {
      name: 'derivation failure falls back to the devkit package segment',
      run: (ctx) => {
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
        ctx.expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[@omega\.js\/devkit:orphan\] /);
        ctx.expect(line).toMatch(/still logs/);
      },
    },

    {
      name: 'error() renders Error instances as their stack',
      run: (ctx) => {
        const logger = new Logger('boom-scope');
        const line = captureConsole('error', () => logger.error(new Error('boom')));
        ctx.expect(line).toMatch(/Error: boom/);
        ctx.expect(line).toMatch(/at /); // stack frames present
      },
    },

    {
      name: 'non-string, non-Error args pass through untouched',
      run: (ctx) => {
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
        ctx.expect(captured[1]).toBe(payload);
        ctx.expect(captured[2]).toBe(42);
      },
    },

    {
      name: 'debug() prints only while OMEGA_DEBUG is set, read live per line',
      run: (ctx) => {
        const logger = new Logger('debug-scope');
        const previous = process.env.OMEGA_DEBUG;
        ctx.after(() => {
          if (previous === undefined) delete process.env.OMEGA_DEBUG;
          else process.env.OMEGA_DEBUG = previous;
        });

        const lines = [];
        const original = console.debug;
        console.debug = (...args) => lines.push(args.map((arg) => stripAnsi(String(arg))).join(' '));
        try {
          delete process.env.OMEGA_DEBUG;
          logger.debug('hidden');
          process.env.OMEGA_DEBUG = '0';
          logger.debug('shown');
        } finally {
          console.debug = original;
        }

        ctx.expect(lines.length).toBe(1);
        ctx.expect(lines[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[@omega\.js\/devkit:debug-scope\] shown$/);
      },
    },
  ],
});

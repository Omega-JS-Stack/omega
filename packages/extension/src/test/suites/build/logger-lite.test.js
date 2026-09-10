// Build-layer test for lib/logger-lite.js — verifies the runtime identity tag
// [@omega.js/extension:name] (no timestamp — devtools stamps runtime lines, #12)
// and the five method surface (log/error/warn/info/debug).

const path = require('path');

const Logger = require(path.join(__dirname, '..', '..', '..', 'lib', 'logger-lite.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

function captureConsole(method, fn) {
  const captured = [];
  const orig = console[method];
  console[method] = function (...args) { captured.push(args); };
  try { fn(); } finally { console[method] = orig; }
  return captured;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'lib/logger-lite — identity tag prefix + five-method surface',
  tests: [
    {
      name: 'constructor stores name',
      run: (ctx) => {
        const log = new Logger('my-component');
        ctx.expect(log.name).toBe('my-component');
      },
    },
    {
      name: 'log() prefixes with [@omega.js/extension:name] and no timestamp',
      run: (ctx) => {
        const log = new Logger('feature-x');
        const captured = captureConsole('log', () => log.log('hello', 'world'));
        ctx.expect(captured.length).toBe(1);
        const [prefix, ...rest] = captured[0];
        ctx.expect(prefix).toBe('[@omega.js/extension:feature-x]');
        ctx.expect(rest).toEqual(['hello', 'world']);
      },
    },
    {
      name: 'exposes log/error/warn/info/debug',
      run: (ctx) => {
        const log = new Logger('s');
        for (const m of ['log', 'error', 'warn', 'info', 'debug']) {
          ctx.expect(typeof log[m]).toBe('function');
        }
      },
    },
    {
      name: 'error() routes through console.error',
      run: (ctx) => {
        const log = new Logger('err-comp');
        const captured = captureConsole('error', () => log.error('boom'));
        ctx.expect(captured.length).toBe(1);
        ctx.expect(captured[0][0]).toBe('[@omega.js/extension:err-comp]');
        ctx.expect(captured[0][1]).toBe('boom');
      },
    },
  ],
});

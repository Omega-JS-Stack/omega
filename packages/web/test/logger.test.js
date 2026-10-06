/**
 * The web runtime's log tag (`core/js/libs/logger.js`) — every browser-side
 * line prints `[@omega.js/web:<module>] message` with NO timestamp (devtools
 * stamps runtime lines; only the build-time devkit logger prefixes
 * [HH:MM:SS]). Mirrors @omega.js/client's `createLogger` API on purpose, but
 * with web's own package segment ([#12]).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

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

/**
 * The BUILD-TIME half of the same contract (`@omega.js/devkit/logger`): a CLI
 * command constructs `new Logger('<verb>')` and the devkit derives the package
 * segment from the constructing file, so the line renders
 * `[HH:MM:SS] [@omega.js/web:<verb>]`. Naming the package (or `omega:`) in the
 * module argument doubles the tag ([#706]).
 */
const fs = require('fs');
const path = require('path');
const Logger = require('@omega.js/devkit/logger');

const SRC_DIR = path.join(__dirname, '..', 'src');

// Strip chalk's escapes so the assertion reads the tag itself.
function plain(value) {
  return String(value).replace(new RegExp('\\u001B\\[[0-9;]*m', 'g'), '');
}

// Every JS file under src/, recursively.
function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.js')) {
      found.push(full);
    }
  }
  return found;
}

module.exports = defineCases({
  type: 'group',
  description: 'logger',
  tests: [
    {
      name: 'logger: prefixes exactly [@omega.js/web:<module>] with no timestamp',
      run: (ctx) => {
        const args = capture('log', () => createLogger('auth').log('policy:', { required: true }));
        ctx.expect(args[0]).toBe('[@omega.js/web:auth]');
        ctx.expect(args[1]).toBe('policy:');
        ctx.expect(args[2]).toEqual({ required: true });
      },
    },

    {
      name: 'logger: sub-module segments ride verbatim',
      run: (ctx) => {
        const args = capture('warn', () => createLogger('account:security').warn('no user'));
        ctx.expect(args[0]).toBe('[@omega.js/web:account:security]');
      },
    },

    {
      name: 'logger: log/info/warn/error/debug each route to their own console method',
      run: (ctx) => {
        const logger = createLogger('redirect');
        for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
          const args = capture(method, () => logger[method]('m'));
          ctx.expect(args[0], `${method} carries the tag`).toBe('[@omega.js/web:redirect]');
          ctx.expect(args[1]).toBe('m');
        }
      },
    },

    {
      name: 'logger: exposes the tag itself (console.group and %c lines embed it)',
      run: (ctx) => {
        ctx.expect(createLogger('checkout').tag).toBe('[@omega.js/web:checkout]');
      },
    },

    {
      name: 'logger: a build-time Logger renders [HH:MM:SS] [@omega.js/web:<module>]',
      run: (ctx) => {
        const args = capture('log', () => new Logger('build').log('starting'));
        ctx.expect(plain(args[0])).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[@omega\.js\/web:build\]$/);
        ctx.expect(plain(args[1])).toBe('starting');
      },
    },

    {
      name: 'logger: no src file prefixes its module segment with the package or omega:',
      run: (ctx) => {
        const offenders = [];
        for (const file of sourceFiles(SRC_DIR)) {
          for (const match of fs.readFileSync(file, 'utf8').matchAll(/new Logger\(\s*(['"`])([^'"`]*)\1/g)) {
            const module = match[2];
            if (module.startsWith('omega:') || module.startsWith('@omega.js/') || module.startsWith('web:')) {
              offenders.push(`${path.relative(SRC_DIR, file)}: new Logger('${module}')`);
            }
          }
        }
        ctx.expect(offenders, `doubled tags:\n${offenders.join('\n')}`).toEqual([]);
      },
    },
  ],
});

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

test('logger: a build-time Logger renders [HH:MM:SS] [@omega.js/web:<module>]', () => {
  const args = capture('log', () => new Logger('build').log('starting'));
  assert.match(plain(args[0]), /^\[\d{2}:\d{2}:\d{2}\] \[@omega\.js\/web:build\]$/);
  assert.strictEqual(plain(args[1]), 'starting');
});

test('logger: no src file prefixes its module segment with the package or omega:', () => {
  const offenders = [];
  for (const file of sourceFiles(SRC_DIR)) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/new Logger\(\s*(['"`])([^'"`]*)\1/g)) {
      const module = match[2];
      if (module.startsWith('omega:') || module.startsWith('@omega.js/') || module.startsWith('web:')) {
        offenders.push(`${path.relative(SRC_DIR, file)}: new Logger('${module}')`);
      }
    }
  }
  assert.deepStrictEqual(offenders, [], `doubled tags:\n${offenders.join('\n')}`);
});

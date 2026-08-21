/**
 * The @omega.js/monitoring entry — the Electron context-aware delegator (#380).
 * Lifted from @omega.js/desktop's lib/sentry/index.js: a desktop Manager
 * singleton requires this file from whichever process it is in, and every call
 * forwards to the right per-context module.
 *
 * Detection:
 *   - renderer: `process.type === 'renderer'` (electron's own signal)
 *   - main:     anything else, including no `process.type` at all (running
 *               outside electron, e.g. in tests)
 *
 * The preload module is a different lifecycle, so it is never auto-detected:
 * reach it at `@omega.js/monitoring/preload`. The non-Electron entries are
 * explicit too — `@omega.js/monitoring/node` for a server process,
 * `@omega.js/monitoring/browser` for a web bundle (which must never `require`
 * this file: it would pull the Electron SDK into a page bundle).
 */

function detectContext() {
  if (typeof process !== 'undefined' && process.type === 'renderer') return 'renderer';
  return 'main';
}

const impl = detectContext() === 'renderer'
  ? require('./renderer.js')
  : require('./main.js');

module.exports = impl;

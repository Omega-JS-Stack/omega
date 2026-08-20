/**
 * The analytics package's log tag — the ONE identity tag every OMEGA surface
 * prints: `[@omega.js/analytics:<module>]` ([#12](https://github.com/Omega-JS-Stack/omega/issues/12)).
 *
 * This package runs on BOTH surfaces (a browser bundle and a Cloud Function),
 * so it follows the runtime shape: no timestamp — devtools and Cloud Logging
 * both stamp their own lines. The twin of @omega.js/client's createLogger,
 * emitting this package's segment.
 *
 * CJS like the rest of the package: the desktop main process and the backend
 * require() it, the browser bundles import it with standard interop.
 */

// The package segment — this file IS @omega.js/analytics, so it is a literal.
const PACKAGE = '@omega.js/analytics';

/**
 * Create a tagged console for one module, e.g. createLogger('events').
 * @param {string} module - The module identity segment.
 * @returns {object} A console-shaped logger whose calls carry the tag.
 */
function createLogger(module) {
  const tag = `[${PACKAGE}:${module}]`;

  // GETTERS returning a BOUND console method, not wrapper arrows: devtools
  // attributes a line to the frame that called console, so a wrapper would make
  // every line read as coming from this file. Resolution stays at ACCESS time,
  // so a test (or a consumer) that swaps console[method] still sees its own stub.
  const logger = { tag };
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    Object.defineProperty(logger, method, {
      get: () => console[method].bind(console, tag),
      enumerable: true,
    });
  }

  return logger;
}

module.exports = { createLogger };

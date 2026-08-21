/**
 * The monitoring package's log tag — the ONE identity tag every OMEGA surface
 * prints: `[@omega.js/monitoring:<module>]` ([#12](https://github.com/Omega-JS-Stack/omega/issues/12)).
 *
 * The twin of @omega.js/analytics' createLogger, emitting this package's
 * segment: no timestamp, because devtools, Cloud Logging and electron-log all
 * stamp their own lines.
 *
 * CJS like the rest of the package: the backend and the electron main process
 * require() it, the browser bundles import it with standard interop.
 */

// The package segment — this file IS @omega.js/monitoring, so it is a literal.
const PACKAGE = '@omega.js/monitoring';

/**
 * Create a tagged console for one module, e.g. createLogger('core').
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

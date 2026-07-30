/**
 * The web runtime's log tag — the ONE identity tag every OMEGA surface prints:
 * `[@omega.js/web:<module>]` ([#12](https://github.com/Omega-JS-Stack/omega/issues/12)).
 *
 * No timestamp: devtools already stamps runtime lines. The build-time twin
 * (`@omega.js/devkit/logger`, used by src/) prefixes `[HH:MM:SS]` before the
 * same tag.
 *
 * Web's OWN file on purpose — the API mirrors @omega.js/client's
 * `createLogger`, but the client's copy would stamp the wrong package segment,
 * and core/js resolves through the `__main_assets__` layer alias rather than
 * the package graph.
 */

// The package segment — this file IS @omega.js/web, so it is a literal.
const PACKAGE = '@omega.js/web';

// Create a tagged console for one module, e.g. createLogger('auth').
export function createLogger(module) {
  const tag = `[${PACKAGE}:${module}]`;

  // GETTERS returning a BOUND console method, not wrapper arrows: devtools
  // attributes a line to the frame that called console, so a wrapper would make
  // every line in the app read as coming from this file. Binding hands the real
  // call site back. Resolution stays at ACCESS time, so a test (or a consumer)
  // that swaps console[method] still sees its own stub.
  const logger = { tag };
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    Object.defineProperty(logger, method, {
      get: () => console[method].bind(console, tag),
      enumerable: true,
    });
  }

  return logger;
}

export default createLogger;

/**
 * The client's runtime log tag — the ONE identity tag every OMEGA surface
 * prints: `[@omega.js/client:<module>]` ([#12](https://github.com/Omega-JS-Stack/omega/issues/12)).
 *
 * No timestamp on purpose: devtools already stamps runtime lines. The
 * build-time twin (`@omega.js/devkit/logger`) is the one that prefixes
 * `[HH:MM:SS]` before the same tag.
 *
 * Every client module logs through this factory — no module hand-writes a tag,
 * so the shape can never drift again.
 */

// The package segment — this file IS @omega.js/client, so it is a literal.
const PACKAGE = '@omega.js/client';

// Create a tagged console for one module, e.g. createLogger('push').
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

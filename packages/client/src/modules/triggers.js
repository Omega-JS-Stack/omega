/**
 * triggers — the ONE click-trigger registry every OMEGA surface shares
 * ([#16](https://github.com/Omega-JS-Stack/omega/issues/16)).
 *
 * A trigger is markup wiring: a class on an element means "clicking this runs
 * that action", with no per-page JS. Before this module every surface rolled
 * its own delegated `document` click listener with its own naming convention
 * (`.auth-signout-btn` in client, `.auth-signin-btn` in extension,
 * `.uj-password-toggle` in web, twice). Now there is exactly ONE listener and
 * exactly one naming rule:
 *
 *   registerTrigger('signout', handler)  →  the class is `omega-signout`
 *
 * The class is ALWAYS `omega-<name>` — callers never spell it, so it can never
 * drift. A click anywhere inside a trigger element counts (closest()), which is
 * what makes icon-only and label-wrapped buttons work.
 *
 * Who registers what: the client registers the GENERIC actions (sign-out), and
 * each surface registers its own (extension: sign-in opens its auth page; web:
 * the password eye). Registration is what arms the listener, so a surface can
 * register before or after `omega.initialize()` — order never matters.
 *
 * Sibling of `motion` and `icon-renderer`: transport-free, DOM-only, and inert
 * where there is no document (desktop main, the extension service worker).
 */

import { createLogger } from './logger.js';

const logger = createLogger('triggers');

// The one prefix. A trigger named `signout` is the class `omega-signout`.
const PREFIX = 'omega-';

// name → handler. Module-level because the registry IS the singleton: one
// document, one listener, one table.
const handlers = new Map();

// True once the ONE delegated listener is attached.
let listening = false;

/**
 * Attach the single delegated listener, once.
 */
function ensureListener() {
  if (listening || typeof document === 'undefined') {
    return;
  }

  listening = true;
  document.addEventListener('click', handleClick);
}

/**
 * The one delegated handler: find the innermost trigger element the click
 * happened inside, then run every trigger that element carries.
 * @param {Event} event
 */
function handleClick(event) {
  if (!handlers.size) {
    return;
  }

  // ONE closest() call over the union selector — the INNERMOST trigger wins,
  // so nesting a trigger inside a trigger is deterministic.
  const selector = [...handlers.keys()].map((name) => `.${PREFIX}${name}`).join(',');
  const element = event.target?.closest?.(selector);

  if (!element) {
    return;
  }

  // A trigger class means the framework owns this click: no default navigation,
  // no page-level handler behind it. Both legacy auth listeners did exactly
  // this, and the markup contract is now the same everywhere.
  event.preventDefault();
  event.stopPropagation();

  for (const [name, handler] of handlers) {
    if (!element.classList.contains(`${PREFIX}${name}`)) {
      continue;
    }

    // A throwing trigger is logged and never allowed to swallow the others.
    // Async handlers (sign-out awaits Firebase) hand their failure back the
    // same way.
    try {
      const result = handler(event, element);
      if (typeof result?.catch === 'function') {
        result.catch((error) => logger.error(`Trigger "${name}" failed:`, error));
      }
    } catch (error) {
      logger.error(`Trigger "${name}" failed:`, error);
    }
  }
}

/**
 * Register a click trigger. The class it answers to is always `omega-<name>`.
 * Re-registering the same name REPLACES the handler (with a warning) — there is
 * no stacking, so a hot reload or a double boot can never double-fire.
 * @param {string} name - trigger name, e.g. 'signout'
 * @param {Function} handler - called with (event, element)
 */
export function registerTrigger(name, handler) {
  if (typeof handler !== 'function') {
    throw new Error(`registerTrigger("${name}") needs a handler function`);
  }

  if (handlers.has(name)) {
    logger.warn(`Trigger "${name}" re-registered — the new handler replaces the old one`);
  }

  handlers.set(name, handler);
  ensureListener();
}

export default registerTrigger;

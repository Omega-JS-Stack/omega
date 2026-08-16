/**
 * Guarded analytics — the ONE way framework page code reaches the pixel
 * globals ([#306](https://github.com/Omega-JS-Stack/omega/issues/306)).
 *
 * `gtag`, `fbq` and `ttq` are page-level snippets, and an ad blocker does not
 * stub them: it keeps them from ever being defined, so a BARE call throws a
 * ReferenceError. Every one of these calls sits in front of the thing the
 * customer just pressed, so that throw takes the action with it — the bug
 * [#283](https://github.com/Omega-JS-Stack/omega/issues/283) fixed inside the
 * billing card, found again in 19 other files.
 *
 * `typeof` against an undeclared name is the one check that does not throw, and
 * every provider is checked on its own: blockers are per-list, so a page that
 * lost Meta still counts Google.
 *
 * Each function is a pass-through of the provider's own call, so a call site
 * reads the way it always did. gtag and fbq are single command functions (any
 * command they take: event, set, init), and ttq is an object of methods, so each
 * method the framework uses gets its own guarded export.
 */

// Google Analytics 4
export function trackGoogle(...args) {
  if (typeof gtag !== 'function') {
    return;
  }

  gtag(...args);
}

// Facebook Pixel
export function trackMeta(...args) {
  if (typeof fbq !== 'function') {
    return;
  }

  fbq(...args);
}

// TikTok Pixel — an event
export function trackTikTok(event, properties) {
  if (typeof ttq === 'undefined' || typeof ttq.track !== 'function') {
    return;
  }

  ttq.track(event, properties);
}

// TikTok Pixel — the identity attached to the events after it
export function identifyTikTok(properties) {
  if (typeof ttq === 'undefined' || typeof ttq.identify !== 'function') {
    return;
  }

  ttq.identify(properties);
}

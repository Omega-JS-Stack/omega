// Auth analytics — the three auth outcomes, fired as canonical events (#328).
// The catalog decides what each provider is told; the transport under it is
// guarded per provider, so a blocked pixel never takes the sign-in with it (#306).
import { event } from '__main_assets__/js/libs/analytics.js';

export function trackLogin(method, user) {
  event('login', {
    method: method,
    user_id: user.uid,
  });
}

/**
 * The BROWSER half of `sign_up` — the catalog's one `placement: 'both'` event.
 *
 * The server half fires from the backend's auth trigger the moment Auth creates
 * the account (`events/auth/on-create.js`), and the two MUST deduplicate or
 * every registration is counted twice. The shared key is the uid:
 *
 *   THE DEDUPE ID IS `sign_up.<uid>`.
 *
 * Meta deduplicates on the (event_name, event_id) pair and TikTok on `event_id`,
 * so both halves name the same string — computed from the one thing both sides
 * hold before either fires. GA4 has NO cross-source deduplication, which is why
 * the server half is Meta + TikTok only: this half owns GA4 outright.
 */
export function trackSignup(method, user) {
  event('sign_up', {
    method: method,
    user_id: user.uid,
  }, {
    eventId: `sign_up.${user.uid}`,
  });
}

export function trackPasswordReset() {
  event('password_reset', {
    method: 'email',
    status: 'success',
  });
}

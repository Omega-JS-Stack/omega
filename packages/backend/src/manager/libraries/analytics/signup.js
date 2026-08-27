/**
 * The SERVER half of `sign_up` — one home for the registration conversion
 * ([#577](https://github.com/Omega-JS-Stack/omega/issues/577)).
 *
 * `sign_up` is the catalog's one `placement: 'both'` event, so the two halves
 * MUST deduplicate or every registration is counted twice.
 *
 *   THE DEDUPE ID IS `sign_up.<uid>`.
 *
 * Meta's Conversions API deduplicates on the PAIR (`event_name`, `event_id`), and
 * TikTok on `event_id` — so both halves have to name the same string, computed
 * from something both sides hold before either fires. The uid is the only such
 * thing: the browser has it the instant Firebase Auth resolves (it is what web's
 * `trackSignup(method, user)` already reads), the server has it here, and it is
 * unique per account for all time. Nothing derived from a clock could ever match
 * across the two.
 *
 * Which is also why this half is META + TIKTOK ONLY: GA4 has no cross-source
 * event_id deduplication, so a Measurement Protocol `sign_up` beside the
 * browser's gtag one is simply two registrations. GA4 keeps its mapping in the
 * catalog — the client half owns that provider (Ian's ruling, stage D).
 *
 * WHERE IT FIRES FROM is the #577 decision. It used to fire from the auth
 * trigger (`events/auth/on-create.js`), which has no HTTP request behind it: no
 * IP, no user agent, no `_fbc`/`_fbp`/`_ttp`, and an attribution the browser had
 * not posted yet — Meta scored the result around 4/10 on match quality. It now
 * fires from `routes/user/signup`, the post-auth request the browser ALREADY
 * makes, which carries all four and runs behind that route's own
 * `flags.signupProcessed` gate — so there is no race with the trigger's write
 * (the route polls for the doc first) and no second fire to deduplicate against.
 * The cost is deliberate and named: a surface that never posts that request
 * (desktop, extension) fires no server half — and it never had match data worth
 * sending anyway.
 */
const { deliverConversion } = require('./conversions.js');
const { buildAttributionContext, buildIdentity } = require('./match-data.js');

/**
 * Everything the fire is made of — pure, so the payload can be read without a
 * route, a request or a platform.
 *
 * @param {object} options
 * @param {object} options.authUser - The Firebase Auth record (uid, email, providerData).
 * @param {object} [options.userRecord] - The user doc as it was just written —
 *   the attribution (cookies included), the consent snapshot, and every personal
 *   match parameter the shared reader takes off it.
 * @param {object} [options.request] - The post-auth request's `{ ip, userAgent }`.
 * @returns {object} The `deliverConversion` payload, minus its ctx + Manager.
 */
function buildSignupFire({ authUser, userRecord, request }) {
  const uid = authUser.uid;

  return {
    event: 'sign_up',
    params: {
      method: resolveSignupMethod(authUser),
      user_id: uid,
    },
    attribution: buildAttributionContext(userRecord?.attribution),
    identity: buildIdentity({
      uid: uid,
      user: userRecord,
      // Auth's own record beats the doc for these two: on a fresh signup the
      // doc's email came FROM it, and a phone-provider account has a number
      // Auth holds and the doc's `personal.telephone` does not.
      email: authUser.email,
      telephone: authUser.phoneNumber,
      request: request,
    }),
    trackingConsent: userRecord?.trackingConsent || null,
    // The two providers that deduplicate on event_id (see the header) — GA4 is
    // the browser half's to fire.
    providers: ['meta', 'tiktok'],
    eventId: `sign_up.${uid}`,
  };
}

/**
 * Fire it (non-blocking, and never at its caller: a registration that already
 * happened must not fail because an ad platform did).
 *
 * @param {object} options - `buildSignupFire`'s, plus the Manager and the ctx.
 * @returns {void}
 */
function trackSignup({ Manager, ctx, authUser, userRecord, request }) {
  try {
    deliverConversion({
      ...buildSignupFire({ authUser, userRecord, request }),
      ctx: ctx,
      Manager: Manager,
    });
  } catch (e) {
    ctx.error(`trackSignup: sign_up tracking failed for ${authUser?.uid}:`, e);
  }
}

/**
 * How this account was created, in the same vocabulary the browser half sends:
 * 'email' for a password signup, otherwise the provider's own name ('google',
 * 'facebook', …) rather than its Firebase id ('google.com').
 *
 * @param {object} authUser - The Firebase Auth record.
 * @returns {string} The method name.
 */
function resolveSignupMethod(authUser) {
  const providerId = authUser?.providerData?.[0]?.providerId;

  if (!providerId || providerId === 'password') {
    return 'email';
  }

  return providerId.replace(/\.com$/, '');
}

module.exports = {
  trackSignup,
  // Exported for testing — the payload IS the contract with the browser half
  buildSignupFire,
  resolveSignupMethod,
};

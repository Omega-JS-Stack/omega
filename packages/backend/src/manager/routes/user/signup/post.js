const moment = require('moment');
const _ = require('lodash');
const { inferContact } = require('../../../libraries/infer-contact.js');
const { trackSignup } = require('../../../libraries/analytics/signup.js');
const { validate: validateEmail, isDisposable, ALL_CHECKS } = require('../../../libraries/email/validation.js');
const prepare = require('../../../libraries/email/prepare.js');

const MAX_POLL_TIME_MS = 30000;
const POLL_INTERVAL_MS = 500;

/**
 * POST /user/signup - Complete user signup
 *
 * Called by client after account creation to:
 * 1. Poll for user doc to exist (waits for onCreate to complete)
 * 2. Validate (reject only if flags.signupProcessed is already true)
 * 3. Gather all data (client details, inferred contact)
 * 4. Write everything to user doc in one merge
 * 5. Fire the server half of sign_up (the one post-auth request that has the match data)
 * 6. Process affiliate referral (writes to referrer's doc)
 * 7. Send welcome emails + add to marketing lists (non-blocking)
 */
module.exports = async ({ ctx, user, settings, libraries }) => {
  const { admin } = libraries;

  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Get target UID
  const uid = settings.uid;

  // Require admin to signup other users
  if (uid !== user.auth.uid && !user.roles.admin) {
    return ctx.respond('Admin required', { code: 403 });
  }

  ctx.log(`signup(): Starting for ${uid}, settings keys=${keyNames(settings)}`);

  // 1. Poll for user doc to exist (wait for onCreate to complete)
  const userDoc = await pollForUserDoc(ctx, uid);

  if (!userDoc) {
    return ctx.respond('User document not found after waiting. Please try again.', { code: 500 });
  }

  ctx.log(`signup(): User doc found for ${uid}`);

  // 2. Check if signup has already been processed
  if (userDoc.flags?.signupProcessed) {
    return ctx.respond('Signup has already been processed', { code: 400 });
  }

  // 3. Fetch the Auth user — needed for the canonical creationTime used to stamp
  //    metadata.created and consent timestamps. flags.signupProcessed (checked above) is
  //    the sole idempotency gate; there is intentionally no account-age window, so a
  //    legitimately-unprocessed account can complete signup whenever it retries.
  const authUser = await admin.auth().getUser(uid).catch((e) => e);

  if (authUser instanceof Error) {
    return ctx.respond(`Failed to get auth user: ${authUser.message}`, { code: 500 });
  }

  // 4. Gather all data, then write once
  const email = user.auth.email;
  const inferred = await inferUserContact(ctx, email);
  ctx.log(`signup(): inferUserContact returned for ${email}:`, inferred);
  const userRecord = buildUserRecord(ctx, {
    settings,
    inferred,
    uid,
    email,
    creationTime: authUser.metadata.creationTime,
    existingDoc: userDoc,
  });

  ctx.log(`signup(): Writing user record for ${uid}, keys=${keyNames(userRecord)}`);

  await admin.firestore().doc(`users/${uid}`)
    .set(userRecord, { merge: true });

  // 5. The SERVER half of `sign_up` (non-blocking)
  //
  // THIS is the request that half was waiting for
  // ([#577](https://github.com/Omega-JS-Stack/omega/issues/577)): the auth
  // trigger it used to fire from has no HTTP request behind it, so it reached
  // Meta and TikTok with no IP, no user agent, no `_fbc`/`_fbp`/`_ttp` and an
  // attribution the browser had not posted yet. Everything it lacked is here —
  // the request's own pair, and the cookies the client sent inside
  // `attribution` (the checkout intent's shape). `flags.signupProcessed`, which
  // this route already refuses a second time, is the once-per-account gate, and
  // the doc it reads was written a line ago, so there is nothing to race.
  trackSignup({
    Manager: ctx.Manager,
    ctx: ctx,
    authUser: authUser,
    userRecord: userRecord,
    request: {
      ip: ctx.request.geolocation?.ip || null,
      userAgent: ctx.request.client?.userAgent || null,
    },
  });

  // 6. Process affiliate referral (writes to referrer's doc, not this user's)
  await processAffiliate(ctx, uid, email, settings);

  // 7. Send emails + marketing (awaited so the function stays alive)
  // They send INLINE in this request, and that costs the user nothing: NOTHING
  // client-side awaits this route — the web auth listener fires the POST and
  // moves straight on to the redirect
  // ([#700](https://github.com/Omega-JS-Stack/omega/issues/700)).
  // Gate marketing sync on explicit consent — never add a user to marketing lists without it
  if (userRecord.consent?.marketing?.status === 'granted') {
    await syncMarketingContact(ctx, uid, email);
  } else {
    ctx.log(`signup(): Skipping marketing sync — consent.marketing.status is "${userRecord.consent?.marketing?.status}"`);
  }
  await sendWelcomeEmails(ctx, uid, inferred?.firstName);

  return ctx.respond({ signedUp: true });
};

/**
 * Poll for user doc to exist (wait for onCreate to complete)
 */
async function pollForUserDoc(ctx, uid) {
  const { admin } = ctx.Manager.libraries;
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    const doc = await admin.firestore().doc(`users/${uid}`)
      .get()
      .catch((e) => {
        ctx.error(`pollForUserDoc(): Error fetching doc:`, e);
        return null;
      });

    if (doc && doc.exists && doc.data()?.auth?.uid) {
      return doc.data();
    }

    ctx.log(`pollForUserDoc(): Waiting for user doc ${uid}...`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  ctx.error(`pollForUserDoc(): Timeout waiting for user doc ${uid}`);
  return null;
}

/**
 * The top-level key names of a payload, for a log line that must not carry the payload.
 *
 * The incoming settings and the record signup writes are both made of the fields a user
 * document is made of — the api keys buildUserRecord() deliberately preserves, the consent
 * records, the request IP, the attribution — and a backend line lands in Cloud Logging for
 * the whole retention window ([#632](https://github.com/Omega-JS-Stack/omega/issues/632)).
 * The SHAPE is what a log reader needs; the values belong at `ctx.debug` or nowhere.
 *
 * @param {*} value - Any payload (a non-object reads as nothing)
 * @returns {string} Comma-joined top-level key names, or '(none)'
 */
function keyNames(value) {
  const keys = value && typeof value === 'object' ? Object.keys(value) : [];

  return keys.length ? keys.join(', ') : '(none)';
}

/**
 * Build the complete user record to write at signup completion.
 *
 * Returns the WHOLE merged document (written without {merge}), layered deepest-first:
 *   1. Manager.User() full schema shape — guarantees every leaf exists (so a doc created by a
 *      partial path, e.g. onCreate never firing, still ends up schema-complete).
 *   2. the existing doc — real values win over the schema defaults, so we never clobber the
 *      user's api keys, subscription, roles, affiliate.code, or any custom/non-standard fields.
 *   3. the signup data — attribution / trackingConsent / activity / consent / flags / personal
 *      we own at signup land on top.
 *
 * Why a full deep-merge instead of `.set(partial, {merge:true})`: Firestore's merge REPLACES a
 * map field rather than deep-merging it, so writing a partial `attribution` flattened onCreate's
 * full attribution object and the OMEGA migration had to re-add every leaf on every signup.
 * Deep-merging in JS and writing the whole doc avoids that entirely.
 */
function buildUserRecord(ctx, { settings, inferred, uid, email, creationTime, existingDoc }) {
  const Manager = ctx.Manager;

  // The resolved geolocation: the request's own headers over whatever the client sent.
  const geolocation = {
    ...(settings.context?.geolocation || {}),
    ...ctx.request.geolocation,
  };

  // Inferred name/company (from AI/regex on the email) — only set when present.
  const personal = {};
  if (inferred?.firstName || inferred?.lastName) {
    personal.name = {
      ...(inferred.firstName ? { first: inferred.firstName } : {}),
      ...(inferred.lastName ? { last: inferred.lastName } : {}),
    };
  }
  if (inferred?.company) {
    personal.company = { name: inferred.company };
  }

  // Location from the request geolocation — only the fields nobody has filled in yet.
  const location = locationFromGeolocation(geolocation, {
    ...(existingDoc?.personal?.location || {}),
    ...(settings.personal?.location || {}),
  });
  if (Object.keys(location).length) {
    personal.location = location;
  }

  // Layer 1: full schema shape (every leaf present with defaults).
  const schemaShape = Manager.User({ auth: { uid, email } }).properties;

  // Layer 3: the data signup owns.
  const signupData = {
    auth: { uid, email },
    flags: { signupProcessed: true },
    activity: {
      ...settings.context,
      geolocation: geolocation,
      client: {
        ...ctx.request.client,
        ...(settings.context?.client || {}),
      },
    },
    attribution: settings.attribution || {},
    trackingConsent: settings.trackingConsent || null,
    consent: buildConsentRecord(ctx, settings.consent, creationTime, existingDoc?.consent),
    metadata: Manager.Metadata().set({ tag: 'user/signup' }),
    ...(Object.keys(personal).length ? { personal } : {}),
  };

  // metadata.created from Auth's creationTime (canonical), matching onCreate + the migration SSOT.
  if (creationTime) {
    const createdDate = new Date(creationTime);
    signupData.metadata.created = {
      timestamp: createdDate.toISOString(),
      timestampUNIX: Math.round(createdDate.getTime() / 1000),
    };
  }

  // Deep-merge: schema (base) ← existing doc (real values win) ← signup data (owned fields win).
  // _.merge mutates its first arg, so start from a fresh object.
  return _.merge({}, schemaShape, existingDoc || {}, signupData);
}

/**
 * The `personal.location` fields the request's geolocation can fill.
 *
 * The header-derived country/region/city landed in `activity.geolocation` and nowhere else, so
 * `personal.location` — the address half of the ad-platform match keys
 * (`libraries/analytics/match-data.js`) and the email merge fields — stayed empty on every
 * account ([#638](https://github.com/Omega-JS-Stack/omega/issues/638)).
 *
 * The fill is per-field and never overwrites: an IP guess loses to anything the user set, in the
 * incoming settings or in the existing doc. Nothing to fill returns an EMPTY object, so the
 * write carries no `personal.location` key at all rather than a map of nulls.
 */
function locationFromGeolocation(geolocation, existingLocation) {
  const location = {};

  for (const field of ['country', 'region', 'city']) {
    if (existingLocation?.[field] || !geolocation?.[field]) {
      continue;
    }

    location[field] = geolocation[field];
  }

  return location;
}

/**
 * Translate the client's lightweight consent payload into the canonical user-doc shape.
 *
 * Client sends: { legal: { granted, text }, marketing: { granted, text } }
 * Server writes: { legal: { status, grantedAt: {...} }, marketing: { status, grantedAt: {...}, revokedAt: {...} } }
 *
 * Server-derived time (not client-supplied) is authoritative — defends against clock
 * manipulation. Uses Auth's creationTime so consent timestamps match metadata.created.
 * IP is captured from request geolocation.
 *
 * Legal is REQUIRED — the client must send legal.granted=true. If missing/false we still
 * record what the client sent, but the route will not have reached this point in practice
 * (the signup-form HTML5-requires the legal checkbox).
 */
function buildConsentRecord(ctx, clientConsent, creationTime, existingConsent) {
  const consent = clientConsent || {};
  const ip = ctx.request.geolocation?.ip || null;

  // Stamp grantedAt/revokedAt from Auth's creationTime so consent timestamps match
  // metadata.created (the OMEGA migration treats metadata.created as the SSOT and reconciles
  // consent.grantedAt against it). Fall back to request start time if creationTime is absent.
  const createdDate = creationTime ? new Date(creationTime) : null;
  const timestamp = createdDate ? createdDate.toISOString() : ctx.meta.startTime.timestamp;
  const timestampUNIX = createdDate ? Math.round(createdDate.getTime() / 1000) : ctx.meta.startTime.timestampUNIX;

  // Build empty leaf shape — used wherever grantedAt or revokedAt is "not set"
  const emptyMeta = { timestamp: null, timestampUNIX: null, source: null, ip: null, text: null };

  // --- Legal ---
  const legalGranted = consent.legal?.granted === true;
  const legalText = typeof consent.legal?.text === 'string' ? consent.legal.text : null;

  let legal = legalGranted
    ? {
      status: 'granted',
      grantedAt: { timestamp, timestampUNIX, source: 'signup', ip, text: legalText },
    }
    : {
      status: 'revoked',
      grantedAt: { ...emptyMeta },
    };

  // --- Marketing ---
  const marketingGranted = consent.marketing?.granted === true;
  const marketingText = typeof consent.marketing?.text === 'string' ? consent.marketing.text : null;

  let marketing = marketingGranted
    ? {
      status: 'granted',
      grantedAt: { timestamp, timestampUNIX, source: 'signup', ip, text: marketingText },
      revokedAt: { ...emptyMeta },
    }
    : {
      status: 'revoked',
      grantedAt: { ...emptyMeta },
      // Record the decline with source=signup-form-declined. text=null (no message shown).
      revokedAt: { timestamp, timestampUNIX, source: 'signup', ip, text: null },
    };

  // Never DOWNGRADE an existing granted consent. A legacy account (signed up before this
  // flow, flags.signupProcessed never set) re-fires /user/signup on page load with empty
  // consent — which would compute status 'revoked' above and, on a {merge:true} write, wipe
  // out the consent they actually granted months ago. If the existing doc already has a
  // consent granted and the incoming payload doesn't explicitly re-grant it, preserve the
  // existing record. A genuine new grant or an at-signup decline (no prior grant) still applies.
  if (existingConsent?.legal?.status === 'granted' && legal.status !== 'granted') {
    legal = existingConsent.legal;
  }
  if (existingConsent?.marketing?.status === 'granted' && marketing.status !== 'granted') {
    marketing = existingConsent.marketing;
  }

  ctx.log(`buildConsentRecord: legal=${legal.status}, marketing=${marketing.status} (raw input legal.granted=${consent.legal?.granted}, marketing.granted=${consent.marketing?.granted})`);

  return { legal, marketing };
}

/**
 * Infer name/company from email using AI (or regex fallback)
 * Returns the inferred contact info, or null on failure
 */
async function inferUserContact(ctx, email) {
  try {
    const inferred = await inferContact(email, ctx);

    if (!inferred?.firstName && !inferred?.lastName && !inferred?.company) {
      ctx.log(`signup(): inferUserContact returned empty result for ${email} (method=${inferred?.method || 'unknown'})`);
      return null;
    }

    ctx.log(`signup(): Inferred contact: ${inferred.firstName || ''} ${inferred.lastName || ''}, company=${inferred.company || ''} (method=${inferred.method})`);

    return inferred;
  } catch (e) {
    ctx.error('signup(): Name inference failed:', e);
    return null;
  }
}

/**
 * Process affiliate referral if affiliate code provided
 * Writes to the referrer's doc (not the current user's)
 */
async function processAffiliate(ctx, uid, email, settings) {
  const { admin } = ctx.Manager.libraries;
  const affiliateCode = settings.attribution?.affiliate?.code || null;

  if (!affiliateCode) {
    return;
  }

  // Skip referral credit for disposable email signups (affiliate fraud prevention)
  if (isDisposable(email)) {
    ctx.log(`processAffiliate(): Skipping referral — disposable email ${email}`);
    return;
  }

  ctx.log(`processAffiliate(): Looking for referrer with code ${affiliateCode}`);

  const snapshot = await admin.firestore().collection('users')
    .where('affiliate.code', '==', affiliateCode)
    .get()
    .catch((e) => {
      ctx.error(`processAffiliate(): Failed to find referrer:`, e);
      throw e;
    });

  if (snapshot.empty) {
    ctx.log(`processAffiliate(): No referrer found with code ${affiliateCode}`);
    return;
  }

  // Update the first matching referrer
  const referrerDoc = snapshot.docs[0];
  const referrerData = referrerDoc.data() || {};

  let referrals = referrerData?.affiliate?.referrals || [];
  referrals = Array.isArray(referrals) ? referrals : [];

  referrals.push({
    uid: uid,
    timestamp: ctx.meta.startTime.timestamp,
  });

  ctx.log(`processAffiliate(): Appending referral to ${referrerDoc.id}`, referrals);

  await admin.firestore().doc(`users/${referrerDoc.id}`)
    .set({
      affiliate: {
        referrals: referrals,
      },
    }, { merge: true })
    .then(() => {
      ctx.log(`processAffiliate(): Success`);
    })
    .catch((e) => {
      ctx.error(`processAffiliate(): Failed to update referrer:`, e);
    });
}

/**
 * Sync marketing contact — validates email (including mailbox verification) before syncing to providers
 */
async function syncMarketingContact(ctx, uid, email) {
  const Manager = ctx.Manager;
  const shouldSend = !ctx.isTesting() || process.env.TEST_EXTENDED_MODE;

  if (!shouldSend) {
    ctx.log(`signup(): Skipping marketing sync (OMEGA_TEST_MODE=true, TEST_EXTENDED_MODE not set)`);
    return;
  }

  // Validate email before adding to marketing lists (includes mailbox verification via NeverBounce/ZeroBounce)
  const validation = await validateEmail(email, { checks: ALL_CHECKS });

  if (!validation.valid) {
    ctx.log(`signup(): Skipping marketing sync — email validation failed:`, validation.checks);
    return;
  }

  const mailer = Manager.Email(ctx);

  try {
    const result = await mailer.sync(uid);
    ctx.log('signup(): Marketing sync:', result);
  } catch (e) {
    ctx.error('signup(): Marketing sync failed:', e);
  }
}

/**
 * Send welcome, checkup, and feedback emails
 *
 * No testing-mode gate here: the mailer's own seam captures a testing send instead
 * of delivering it, so these run for real in every environment and a broken one
 * fails a test ([#774](https://github.com/Omega-JS-Stack/omega/issues/774)).
 */
async function sendWelcomeEmails(ctx, uid, firstName) {
  await Promise.all([
    sendWelcomeEmail(ctx, uid, firstName).catch(e => ctx.error('signup(): sendWelcomeEmail failed:', e)),
    sendDiscountNudgeEmail(ctx, uid, firstName).catch(e => ctx.error('signup(): sendDiscountNudgeEmail failed:', e)),
    sendCheckupEmail(ctx, uid, firstName).catch(e => ctx.error('signup(): sendCheckupEmail failed:', e)),
    sendFeedbackEmail(ctx, uid, firstName).catch(e => ctx.error('signup(): sendFeedbackEmail failed:', e)),
  ]);
}

/**
 * Send welcome email (immediate)
 */
async function sendWelcomeEmail(ctx, uid, firstName) {
  const Manager = ctx.Manager;
  const mailer = Manager.Email(ctx);
  const greeting = firstName ? `Hey ${firstName}, welcome` : 'Welcome';
  // Throws when brand.contact.person is unconfigured — the send is individually
  // caught + logged by sendWelcomeEmails(), so signup still succeeds.
  const person = prepare.resolvePerson(Manager.config.brand);

  return mailer.send({
    to: uid,
    sender: 'hello',
    categories: ['account/welcome'],
    subject: `Welcome to ${Manager.config.brand.name}!`,
    template: 'card',
    copy: false,
    data: {
      email: {
        preview: `Welcome aboard! I'm ${person.firstName}, the CEO and founder of ${Manager.config.brand.name}. I'm here to ensure your journey with us gets off to a great start.`,
      },
      content: {
        title: `Welcome to ${Manager.config.brand.name}!`,
        message: `${greeting} aboard!

I'm ${person.firstName}, the founder and CEO of **${Manager.config.brand.name}**, and I'm thrilled to have you with us. Your journey begins today, and we are committed to supporting you every step of the way.

We are dedicated to ensuring your experience is exceptional. Feel free to reply directly to this email with any questions you may have.

Thank you for choosing **${Manager.config.brand.name}**. Here's to new beginnings!`,
      },
      // Identity comes from brand.contact.person via prepare.resolveSignoff().
      signoff: {
        type: 'personal',
      },
    },
  })
    .then((result) => {
      ctx.log('sendWelcomeEmail(): Success', result.status);
      return result;
    });
}

/**
 * Send discount-nudge email (24 hours after signup)
 *
 * A warm, personal check-in that offers a discount code in exchange for a reply.
 * Scheduled fire-and-forget via sendAt (same pattern as checkup/feedback) — there is
 * intentionally no premium check at send time, so a user who upgrades within 24h may
 * still receive it. The copy is deliberately worded as a friendly thank-you (not "you
 * haven't upgraded") so it reads fine regardless of the recipient's current plan.
 *
 * The reply itself is the goal: replies are a strong positive sender-reputation signal,
 * and a real human check-in lands in the Primary tab rather than Promotions. Inbound
 * reply handling (auto-issuing the code) is out of scope here — replies are handled
 * separately.
 *
 * Subject is personalized with the recipient's first name when available, and uses
 * intrigue framing ("something for you 🎁") rather than spam-trigger words ("free",
 * "claim", "bonus") to protect deliverability.
 */
async function sendDiscountNudgeEmail(ctx, uid, firstName) {
  const Manager = ctx.Manager;
  const mailer = Manager.Email(ctx);
  const greeting = firstName ? `Hey ${firstName}` : 'Hey there';
  const subject = firstName
    ? `${firstName}, I've got something for you 🎁`
    : `I've got something for you 🎁`;
  // Throws when brand.contact.person is unconfigured — caught per-send by the caller.
  const person = prepare.resolvePerson(Manager.config.brand);

  return mailer.send({
    to: uid,
    sender: 'hello',
    categories: ['engagement/discount-nudge'],
    subject: subject,
    template: 'card',
    copy: false,
    sendAt: moment().add(24, 'hours').unix(),
    data: {
      email: {
        preview: `Just checking in from ${Manager.config.brand.name} — and I've got a little thank-you for you.`,
      },
      content: {
        title: `How's it going?`,
        message: `${greeting},

It's ${person.firstName}, the founder of **${Manager.config.brand.name}**.

As a thank-you for giving us a try, I'd love to send you a code for a **premium upgrade**.

**Just reply to this email** and I'll get one over to you.

I read every reply and I'm looking forward to hearing from you!`,
      },
      // Identity comes from brand.contact.person via prepare.resolveSignoff().
      signoff: {
        type: 'personal',
      },
    },
  })
    .then((result) => {
      ctx.log('sendDiscountNudgeEmail(): Success', result.status);
      return result;
    });
}

/**
 * Send checkup email (7 days after signup)
 */
async function sendCheckupEmail(ctx, uid, firstName) {
  const Manager = ctx.Manager;
  const mailer = Manager.Email(ctx);
  const greeting = firstName ? `Hey ${firstName}` : 'Hi there';
  // Throws when brand.contact.person is unconfigured — caught per-send by the caller.
  const person = prepare.resolvePerson(Manager.config.brand);

  return mailer.send({
    to: uid,
    sender: 'hello',
    categories: ['account/checkup'],
    subject: `How is your experience with ${Manager.config.brand.name}?`,
    template: 'card',
    copy: false,
    sendAt: moment().add(5, 'days').unix(),
    data: {
      email: {
        preview: `Checking in from ${Manager.config.brand.name} to see how things are going. Let us know if you have any questions or feedback!`,
      },
      content: {
        title: `How's everything going?`,
        message: `${greeting},

It's ${person.firstName} again from **${Manager.config.brand.name}**. Just checking in to see how things are going for you.

Have you had a chance to explore all our features? Any questions or feedback for us?

We're always here to help, so don't hesitate to reach out. Just reply to this email and we'll get back to you as soon as possible.

Thank you for choosing **${Manager.config.brand.name}**. Here's to new beginnings!`,
      },
      // Identity comes from brand.contact.person via prepare.resolveSignoff().
      signoff: {
        type: 'personal',
      },
    },
  })
    .then((result) => {
      ctx.log('sendCheckupEmail(): Success', result.status);
      return result;
    });
}

/**
 * Send feedback email (10 days after signup)
 */
function sendFeedbackEmail(ctx, uid, firstName) {
  const Manager = ctx.Manager;
  const mailer = Manager.Email(ctx);
  const first = firstName || 'You';

  return mailer.send({
    to: uid,
    sender: 'hello',
    categories: ['engagement/feedback'],
    subject: `${first} + feedback = Amazon gift card 🎁`,
    template: 'feedback',
    copy: false,
    sendAt: moment().add(10, 'days').unix(),
  })
    .then((result) => {
      ctx.log('sendFeedbackEmail(): Success', result.status);
      return result;
    });
}

// Exported for unit tests (pure, no I/O).
module.exports.locationFromGeolocation = locationFromGeolocation;
module.exports.keyNames = keyNames;

/**
 * Test: server conversion delivery — the match data every platform receives
 * ([#385](https://github.com/Omega-JS-Stack/omega/issues/385), stage D of
 * [#302](https://github.com/Omega-JS-Stack/omega/issues/302)).
 *
 * The point of the stage is that a server conversion can be MATCHED to the human
 * who clicked the ad. So these tests read the actual bodies that would go on the
 * wire — built by the real adapters from `@omega.js/analytics`' catalog, fed by
 * the real match-data builders — from a realistic order: attribution with both
 * touches, the platform cookies the checkout collected, the request pair the
 * intent captured, and the tracking-consent snapshot.
 *
 * Three contracts under test:
 *   1. Match data — hashed email/phone (raw PII never leaves), external_id, the
 *      click ids and cookies in each platform's own slot, IP + user agent.
 *   2. The consent gate — an explicit `false` blocks its category's providers;
 *      an ABSENT snapshot (legacy orders, the raw-API recovery lane) allows all.
 *   3. Absence never throws — an order with no attribution and no request still
 *      delivers, on external_id alone.
 *
 * Pure functions, zero I/O: nothing here reaches a platform (the sandbox brand
 * configures no pixel ids, and the assertions are on the bodies, not on sends).
 *
 * Run: npx omega test framework:analytics/conversion-delivery
 */
const crypto = require('crypto');
const conversions = require('../../src/manager/libraries/analytics/conversions.js');
const matchData = require('../../src/manager/libraries/analytics/match-data.js');

// A uid the way one actually looks — Firebase's alphabet is case-SENSITIVE —
// carrying the padding a stored id can pick up. A lowercased or untrimmed
// digest is a different digest, so a fixture that was already trim and
// lowercase would have let either drift through unnoticed.
const UID = '  AYVZezRcE9CsyI ';
const UID_TRIMMED = 'AYVZezRcE9CsyI';
// TikTok's Events API documents external_id as "SHA-256 hashing is required",
// while Meta documents it as "Hashing recommended" and its own Pixel example
// sends a raw id ([#410](https://github.com/Omega-JS-Stack/omega/issues/410)).
// So the two platforms take the SAME uid in two shapes, and the digest is
// hard-coded (shasum of the TRIMMED, case-preserved uid) rather than computed
// here: a hash that stops matching the browser half's `ttq.identify()` fails
// here instead of on a live pixel.
const UID_DIGEST = '12266491d7fe2f07c833999f4d011444564df71cfd7aaafb346f0edf473572b4';
const EMAIL = 'Buyer@Example.COM';
const IP = '203.0.113.7';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// The attribution shape the landing capture writes and the intent fold carries:
// an organic first touch, a paid last touch, plus the cookies read at checkout.
function fullAttribution() {
  return {
    first: {
      tags: { utm_source: 'newsletter', utm_medium: 'email' },
      referrer: 'https://news.ycombinator.com/',
      url: 'https://brand.test/',
      page: '/',
      timestamp: '2026-06-01T00:00:00.000Z',
    },
    last: {
      tags: { utm_source: 'meta', utm_medium: 'cpc', utm_campaign: 'launch', utm_term: 'omega', utm_content: 'hero' },
      clickIds: { fbclid: 'FB-CLICK', gclid: 'G-CLICK', ttclid: 'TT-CLICK' },
      referrer: 'https://facebook.com/',
      url: 'https://brand.test/pricing?utm_source=meta',
      page: '/pricing',
      timestamp: '2026-08-01T00:00:00.000Z',
    },
    affiliate: { code: 'IAN7', timestamp: '2026-08-01T00:00:00.000Z', url: 'https://brand.test/', page: '/' },
    cookies: { fbc: 'fb.1.1754006400000.REAL-COOKIE', fbp: 'fb.1.1754006400000.987654321', ttp: 'TTP-COOKIE' },
  };
}

const PURCHASE_PARAMS = {
  transaction_id: '_test-sub-conversion',
  value: 9.99,
  currency: 'USD',
  items: [{ item_id: 'premium', item_name: 'Premium', price: 9.99, quantity: 1 }],
  payment_processor: 'stripe',
  payment_frequency: 'monthly',
  is_trial: false,
  is_recurring: false,
};

/** Deliver one event exactly as the payment webhook would, and hand back the per-provider results. */
function deliver({ ctx, Manager, event = 'purchase', params = PURCHASE_PARAMS, attribution = fullAttribution(), trackingConsent = null, providers, identity }) {
  return conversions.deliverConversion({
    event: event,
    params: params,
    providers: providers,
    attribution: matchData.buildAttributionContext(attribution),
    identity: identity || matchData.buildIdentity({
      uid: UID,
      email: EMAIL,
      telephone: { countryCode: 1, national: 5550102030 },
      request: { ip: IP, userAgent: USER_AGENT },
    }),
    trackingConsent: trackingConsent,
    eventId: `${event}._test-webhook-event`,
    ctx: ctx,
    Manager: Manager,
  });
}

function descriptorFor(results, provider) {
  return results.find((result) => result.provider === provider)?.descriptor;
}

function outcomeFor(results, provider) {
  return results.find((result) => result.provider === provider)?.outcome;
}

module.exports = {
  description: 'Server conversion delivery: match data, consent gating, absent-data tolerance',
  type: 'group',

  tests: [
    {
      name: 'meta-user-data-carries-the-full-match-block',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        const results = deliver({ ctx, Manager });
        const body = conversions.buildMetaBody({
          descriptor: descriptorFor(results, 'meta'),
          identity: matchData.buildIdentity({
            uid: UID,
            email: EMAIL,
            telephone: { countryCode: 1, national: 5550102030 },
            request: { ip: IP, userAgent: USER_AGENT },
          }),
          eventId: 'purchase._test-webhook-event',
        });

        const event = body.data[0];

        assert.equal(event.event_name, 'Purchase', 'the catalog names the Meta event');
        assert.equal(event.event_id, 'purchase._test-webhook-event', 'the dedupe id rides the event');
        assert.equal(event.action_source, 'website');

        // Identity — hashed, never raw
        assert.equal(event.user_data.em, sha256('buyer@example.com'), 'email is SHA256 of the trimmed lowercase address');
        assert.equal(event.user_data.ph, sha256('15550102030'), 'phone is SHA256 of the digits, country code included');
        assert.equal(event.user_data.external_id, UID, 'Meta only RECOMMENDS hashing external_id, and its Pixel half sends the raw uid (#410)');
        assert.equal(JSON.stringify(event).includes(EMAIL), false, 'the raw email must never appear anywhere in the body');
        assert.equal(JSON.stringify(event).includes('5550102030'), false, 'the raw phone number must never appear anywhere in the body');

        // Same-device match
        assert.equal(event.user_data.client_ip_address, IP);
        assert.equal(event.user_data.client_user_agent, USER_AGENT);
        assert.equal(event.user_data.fbc, 'fb.1.1754006400000.REAL-COOKIE', 'the real cookie wins over any construction');
        assert.equal(event.user_data.fbp, 'fb.1.1754006400000.987654321');

        // Commerce, in Meta's own vocabulary (the catalog's map)
        assert.equal(event.custom_data.value, 9.99);
        assert.equal(event.custom_data.currency, 'USD');
        assert.deepEqual(event.custom_data.content_ids, ['premium']);
        assert.equal(event.custom_data.fbc, undefined, 'match data never rides the custom data');
      },
    },

    {
      name: 'meta-constructs-fbc-from-the-captured-fbclid',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        // The cookie never made it to checkout (cleared jar, ITP, another device)
        const attribution = fullAttribution();
        delete attribution.cookies.fbc;

        const results = deliver({ ctx, Manager, attribution });
        const descriptor = descriptorFor(results, 'meta');
        const capturedMs = Date.parse('2026-08-01T00:00:00.000Z');

        assert.equal(descriptor.userData.fbc, `fb.1.${capturedMs}.FB-CLICK`, 'fbc is built per Meta spec from the click id, stamped when it was captured');
        assert.equal(descriptor.userData.fbp, 'fb.1.1754006400000.987654321', 'the browser cookie is untouched by the construction');

        // Nothing to build from is not an error — the fire still goes with what it has
        const noClick = fullAttribution();
        delete noClick.cookies.fbc;
        delete noClick.last.clickIds.fbclid;

        const bare = descriptorFor(deliver({ ctx, Manager, attribution: noClick }), 'meta');
        assert.equal(bare.userData.fbc, undefined, 'no cookie and no fbclid means no fbc, never a malformed one');
      },
    },

    {
      name: 'tiktok-context-carries-the-full-match-block',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        const results = deliver({ ctx, Manager });
        const body = conversions.buildTikTokBody({
          descriptor: descriptorFor(results, 'tiktok'),
          identity: matchData.buildIdentity({
            uid: UID,
            email: EMAIL,
            telephone: { countryCode: 1, national: 5550102030 },
            request: { ip: IP, userAgent: USER_AGENT },
          }),
          eventId: 'purchase._test-webhook-event',
          pixelCode: '_TEST_PIXEL',
        });

        const event = body.data[0];

        assert.equal(event.event, 'CompletePayment', 'the catalog names the TikTok event');
        assert.equal(event.event_id, 'purchase._test-webhook-event');
        assert.equal(event.context.user.email, sha256('buyer@example.com'), 'TikTok takes the email hashed too');
        assert.equal(event.context.user.phone_number, sha256('+15550102030'), 'TikTok\'s spec is the E.164 number, plus included');
        assert.equal(event.context.user.external_id, UID_DIGEST, 'TikTok REQUIRES external_id hashed, and a raw one matches nobody (#410)');
        assert.equal(JSON.stringify(event).includes(UID_TRIMMED), false, 'the raw uid must not ride a TikTok body under any key');
        assert.equal(event.context.user.ttp, 'TTP-COOKIE');
        assert.equal(event.context.ad.callback, 'TT-CLICK', 'the TikTok click id rides context.ad.callback');
        assert.equal(event.context.ip, IP);
        assert.equal(event.context.user_agent, USER_AGENT);
        assert.equal(event.properties.content_id, 'premium', 'TikTok commerce is single-item');
        assert.equal(event.properties.value, 9.99);
      },
    },

    {
      name: 'ga4-gains-the-campaign-params-and-gclid',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        const descriptor = descriptorFor(deliver({ ctx, Manager }), 'ga4');

        assert.equal(descriptor.name, 'purchase');
        assert.equal(descriptor.payload.source, 'meta', 'last touch is the credited one');
        assert.equal(descriptor.payload.medium, 'cpc');
        assert.equal(descriptor.payload.campaign, 'launch');
        assert.equal(descriptor.payload.term, 'omega');
        assert.equal(descriptor.payload.content, 'hero');
        assert.equal(descriptor.payload.gclid, 'G-CLICK', 'the Google click id rides as an event param');
        assert.equal(descriptor.payload.value, 9.99, 'the commerce params are untouched');
        assert.equal(descriptor.payload.fbc, undefined, 'another platform\'s match data never rides GA4');
      },
    },

    {
      name: 'campaign-falls-back-to-the-first-touch',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        // A user who arrived on a tagged link and never came back through one:
        // last touch is only ever written by a tagged visit (#384).
        const attribution = fullAttribution();
        delete attribution.last;

        const descriptor = descriptorFor(deliver({ ctx, Manager, attribution }), 'ga4');

        assert.equal(descriptor.payload.source, 'newsletter', 'first touch credits the conversion when there is no last');
        assert.equal(descriptor.payload.medium, 'email');
        assert.equal(descriptor.payload.campaign, undefined, 'a param the touch never carried is absent, not empty');
      },
    },

    {
      name: 'marketing-declined-blocks-meta-and-tiktok-but-not-ga4',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        const results = deliver({
          ctx,
          Manager,
          trackingConsent: { analytics: true, marketing: false, region: 'opt-in', version: 1 },
        });

        assert.equal(outcomeFor(results, 'meta'), 'skipped (consent: marketing)', 'an opted-out user reaches no ad platform');
        assert.equal(outcomeFor(results, 'tiktok'), 'skipped (consent: marketing)');
        assert.equal(descriptorFor(results, 'meta'), undefined, 'a blocked provider never even resolves its payload');
        assert.equal(outcomeFor(results, 'ga4').startsWith('skipped (consent'), false, 'analytics was granted, so GA4 still counts it');
      },
    },

    {
      name: 'analytics-declined-blocks-ga4-but-not-the-ad-platforms',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        const results = deliver({
          ctx,
          Manager,
          trackingConsent: { analytics: false, marketing: true, region: 'opt-in', version: 1 },
        });

        assert.equal(outcomeFor(results, 'ga4'), 'skipped (consent: analytics)');
        assert.equal(outcomeFor(results, 'meta').startsWith('skipped (consent'), false, 'the two categories gate independently');
      },
    },

    {
      name: 'an-absent-snapshot-is-not-a-denial',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        // A legacy order, or one minted by the raw-API recovery lane, carries no
        // snapshot at all. Blocking it would be a silent revenue hole.
        for (const snapshot of [null, undefined, {}]) {
          const granted = conversions.resolveTrackingConsent(snapshot);

          assert.equal(granted.analytics, true, `${JSON.stringify(snapshot)} allows analytics`);
          assert.equal(granted.marketing, true, `${JSON.stringify(snapshot)} allows marketing`);
        }

        const results = deliver({ ctx, Manager, trackingConsent: null });

        for (const provider of ['ga4', 'meta', 'tiktok']) {
          assert.equal(outcomeFor(results, provider).startsWith('skipped (consent'), false, `${provider} fires without a snapshot`);
        }
      },
    },

    {
      name: 'an-order-with-no-attribution-still-fires-on-external-id',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        // The raw-API recovery lane: no browser was ever involved, so there is no
        // attribution, no cookies and no request pair.
        const results = deliver({
          ctx,
          Manager,
          attribution: {},
          identity: matchData.buildIdentity({ uid: UID }),
        });

        const body = conversions.buildMetaBody({
          descriptor: descriptorFor(results, 'meta'),
          identity: matchData.buildIdentity({ uid: UID }),
          eventId: 'purchase._test-webhook-event',
        });

        assert.deepEqual(body.data[0].user_data, { external_id: UID }, 'external_id alone — no empty match keys invented');

        // The lane where external_id is the ONLY match key is exactly where its
        // shape decides whether the fire matches anybody at all (#410).
        const tiktok = conversions.buildTikTokBody({
          descriptor: descriptorFor(results, 'tiktok'),
          identity: matchData.buildIdentity({ uid: UID }),
          eventId: 'purchase._test-webhook-event',
          pixelCode: '_TEST_PIXEL',
        });

        assert.deepEqual(tiktok.data[0].context.user, { external_id: UID_DIGEST }, 'TikTok\'s lone match key is the digest its Events API requires');

        assert.equal(descriptorFor(results, 'ga4').payload.source, undefined, 'no campaign params either');
        assert.equal(outcomeFor(results, 'meta').startsWith('skipped (consent'), false, 'missing match data never blocks the fire');
      },
    },

    {
      // `sign_up` is a `placement: 'both'` event, and its two halves do NOT all
      // deduplicate: Meta and TikTok merge on event_id, GA4 has no cross-source
      // dedupe at all — a Measurement Protocol sign_up beside the browser's gtag
      // one is simply two registrations. So the server half names the providers
      // it owns, and GA4 stays mapped in the catalog for the client.
      name: 'a-provider-the-other-half-owns-is-never-fired',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        const results = deliver({
          ctx,
          Manager,
          event: 'sign_up',
          params: { method: 'email', user_id: UID },
          providers: ['meta', 'tiktok'],
        });

        assert.equal(outcomeFor(results, 'ga4'), 'skipped (not selected)', 'GA4 must not be fired by a half that cannot dedupe against the other');
        assert.equal(descriptorFor(results, 'ga4'), undefined, 'an unselected provider never even resolves its payload');

        // The two that DO dedupe are resolved and handed to their transport.
        for (const provider of ['meta', 'tiktok']) {
          assert.equal(descriptorFor(results, provider).name, 'CompleteRegistration', `${provider} resolves its native event`);
          assert.equal(outcomeFor(results, provider).startsWith('skipped (not selected)'), false, `${provider} is this half's to fire`);
        }

        // Unrestricted stays unrestricted — the seam is opt-in per fire.
        const everyProvider = deliver({ ctx, Manager, event: 'sign_up', params: { method: 'email', user_id: UID } });

        assert.equal(outcomeFor(everyProvider, 'ga4').startsWith('skipped (not selected)'), false, 'a fire that names no providers reaches every mapped one');
      },
    },

    {
      name: 'an-account-with-no-phone-sends-no-phone-hash',
      auth: 'none',

      async run({ assert }) {
        // The account schema stores the pair as NUMBERS defaulting to 0. Hashing
        // that would give every phoneless account the same match key — junk the
        // platforms would happily match strangers to each other on.
        for (const hash of [matchData.hashPhone, matchData.hashPhoneE164]) {
          assert.equal(hash({ countryCode: 0, national: 0 }), null, 'the schema default is no phone');
          assert.equal(hash(undefined), null);
        }

        assert.equal(matchData.hashPhone({ countryCode: 1, national: 5550102030 }), sha256('15550102030'), 'a real number still hashes');

        // Firebase Auth hands the trigger an E.164 string instead of the pair.
        assert.equal(matchData.hashPhone('+1 555-010-2030'), sha256('15550102030'), 'the Auth record shape hashes to the same digest');

        const identity = matchData.buildIdentity({ uid: UID, telephone: { countryCode: 0, national: 0 } });

        assert.equal(Object.hasOwn(identity, 'metaPhoneHash'), false, 'an unresolvable match key is absent, never empty');
        assert.equal(Object.hasOwn(identity, 'tiktokPhoneHash'), false, 'and neither normalization invents one');
      },
    },

    {
      // ONE hash used to go to every provider, and the platforms do not agree on
      // what to hash ([#392](https://github.com/Omega-JS-Stack/omega/issues/392)):
      // Meta's advanced matching wants bare digits, TikTok's Events API the E.164
      // form WITH the plus. Same person, two digests — an off-spec key does not
      // error, it just silently matches nobody.
      name: 'the-phone-hash-is-normalized-per-provider-spec',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        const telephone = { countryCode: 1, national: 5550102030 };
        const identity = matchData.buildIdentity({ uid: UID, telephone: telephone });

        assert.equal(identity.metaPhoneHash, sha256('15550102030'), 'Meta hashes the bare digits');
        assert.equal(identity.tiktokPhoneHash, sha256('+15550102030'), 'TikTok hashes the E.164 number');
        assert.equal(identity.metaPhoneHash === identity.tiktokPhoneHash, false, 'two specs, two digests — never one hash for both');

        // The same normalizers the browser half uses (`@omega.js/analytics/identity`),
        // so a server conversion and a pixel event carry the SAME match key.
        const results = deliver({ ctx, Manager, identity });

        const meta = conversions.buildMetaBody({ descriptor: descriptorFor(results, 'meta'), identity: identity, eventId: 'purchase._test-webhook-event' });
        const tiktok = conversions.buildTikTokBody({ descriptor: descriptorFor(results, 'tiktok'), identity: identity, eventId: 'purchase._test-webhook-event', pixelCode: '_TEST_PIXEL' });

        assert.equal(meta.data[0].user_data.ph, sha256('15550102030'), 'the Meta body carries the digits-only digest');
        assert.equal(tiktok.data[0].context.user.phone_number, sha256('+15550102030'), 'the TikTok body carries the E.164 digest');
      },
    },

    {
      name: 'an-event-name-the-catalog-does-not-know-is-loud-and-harmless',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        // A typo in a canonical name used to be SILENT: every adapter returned
        // null, and the fire read exactly like `plan_changed` on Meta — a
        // deliberate non-mapping. So a webhook could stop reporting revenue and the logs
        // would say nothing was wrong. The outcome is now its own word, and the
        // walk still cannot take the webhook down with it.
        const warnings = [];
        const record = (line) => warnings.push(String(line));
        const guarded = { ...ctx, log: record, error: record, warn: record };

        const results = conversions.deliverConversion({
          event: 'purchsae',
          params: PURCHASE_PARAMS,
          eventId: 'purchsae._test-typo',
          ctx: guarded,
          Manager: Manager,
        });

        for (const provider of ['ga4', 'meta', 'tiktok']) {
          assert.equal(outcomeFor(results, provider), 'skipped (unknown event)', `${provider} must say the NAME was wrong, not that the provider declined to map a real event`);
        }

        const loud = warnings.filter((line) => line.includes('[unknown canonical event]'));

        assert.equal(loud.length, 1, `exactly one loud line, not one per provider: ${warnings.join(' | ')}`);
        assert.equal(loud[0].includes('purchsae'), true, `the line must name the offender: ${loud[0]}`);
      },
    },

    {
      name: 'the-outcomes-an-ad-platform-has-no-use-for-reach-ga4-only',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        // The catalog maps none of these on Meta or TikTok — an unmapped provider
        // is a decision, and the adapter skips rather than inventing an event.
        // `trial_lapsed` is the deliberate omission of the exclusion lane below
        // ([#415](https://github.com/Omega-JS-Stack/omega/issues/415)): a lapsed
        // trialist is a win-back audience to retarget, not one to hide ads from.
        // The other two are [#407](https://github.com/Omega-JS-Stack/omega/issues/407)'s
        // lifecycle additions, dark to an ad platform because no money moved.
        for (const event of ['subscription_uncancelled', 'plan_changed', 'trial_lapsed']) {
          const results = deliver({ ctx, Manager, event });

          assert.equal(descriptorFor(results, 'ga4').name, event, `${event} resolves on GA4 under its own name`);
          assert.equal(outcomeFor(results, 'meta'), 'skipped (no mapping)', `${event} has no Meta mapping`);
          assert.equal(outcomeFor(results, 'tiktok'), 'skipped (no mapping)', `${event} has no TikTok mapping`);
        }
      },
    },

    {
      name: 'a-cancellation-and-a-refund-build-exclusion-audiences-worth-zero',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        // The churn moments an ad platform CAN use
        // ([#415](https://github.com/Omega-JS-Stack/omega/issues/415)): neither
        // Meta nor TikTok can subtract revenue and neither optimizes against an
        // event, but both can build an exclusion audience from a custom one. So
        // each webhook fire that already reaches GA4 now resolves on the two
        // platforms as well — at value ZERO, because a refund carrying its
        // amount would ADD to the return their ads manager reports.
        for (const [event, native] of [['subscription_cancelled', 'SubscriptionCancelled'], ['refund', 'Refunded']]) {
          const results = deliver({ ctx, Manager, event });

          const google = descriptorFor(results, 'ga4');
          const meta = descriptorFor(results, 'meta');
          const tiktok = descriptorFor(results, 'tiktok');

          assert.equal(google.name, event, `${event} still resolves on GA4 under its own name`);
          assert.equal(google.payload.value, 9.99, 'GA4 keeps the real number — its revenue report is where a refund nets out');

          assert.equal(meta.name, native, `${event} reaches Meta as ${native}`);
          assert.equal(meta.kind, 'custom', 'Meta defines no churn event, so the pixel command is trackCustom');
          assert.equal(meta.payload.value, 0, 'a churn signal must never book revenue in an ad account');
          assert.deepEqual(meta.payload.content_ids, ['premium'], 'the plan is what makes the audience worth building');

          assert.equal(tiktok.name, native, `${event} reaches TikTok as ${native}`);
          assert.equal(tiktok.kind, 'custom');
          assert.equal(tiktok.payload.value, 0, 'TikTok cannot subtract revenue either');
          assert.equal(tiktok.payload.content_id, 'premium');
          assert.equal(tiktok.payload.price, undefined, 'the per-item price would put the amount back on the wire');
          assert.equal(tiktok.payload.quantity, undefined, 'so it comes off with the value, like Meta\'s signal');

          // The bodies that would go on the wire carry the same zero.
          const body = conversions.buildMetaBody({ descriptor: meta, identity: {}, eventId: `${event}._test-webhook-event` });
          const tiktokBody = conversions.buildTikTokBody({ descriptor: tiktok, identity: {}, eventId: `${event}._test-webhook-event`, pixelCode: '_TEST_PIXEL' });

          assert.equal(body.data[0].event_name, native);
          assert.equal(body.data[0].custom_data.value, 0);
          assert.equal(tiktokBody.data[0].event, native);
          assert.equal(tiktokBody.data[0].properties.value, 0);
          assert.equal(JSON.stringify(tiktokBody).includes('9.99'), false, 'no amount rides a churn body under ANY key');
        }
      },
    },

    {
      name: 'a-trial-conversion-reaches-all-three-as-real-revenue',
      auth: 'none',

      async run({ assert, ctx, Manager }) {
        // The one [#407] addition where money actually moved, so unlike the four
        // above it carries a full mapping: GA4's standard purchase (revenue
        // belongs in the revenue report) and each ad platform's own Subscribe.
        const results = deliver({
          ctx,
          Manager,
          event: 'trial_converted',
          params: { ...PURCHASE_PARAMS, is_trial: true, is_recurring: false },
        });

        const google = descriptorFor(results, 'ga4');

        assert.equal(google.name, 'purchase', 'the first real charge lands in GA4 revenue');
        assert.equal(google.payload.value, 9.99);
        assert.equal(google.payload.is_trial, true, 'the flag pair is what marks it inside GA4 purchase');
        assert.equal(google.payload.is_recurring, false);

        assert.equal(descriptorFor(results, 'meta').name, 'Subscribe');
        assert.equal(descriptorFor(results, 'tiktok').name, 'Subscribe');
      },
    },
  ],
};
